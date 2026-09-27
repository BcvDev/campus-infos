require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const { Document, Packer, Table, TableRow, TableCell, Paragraph, TextRun, WidthType, HeadingLevel, AlignmentType } = require('docx');
const archiver = require('archiver');
const db = require('./db');

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// Date limite de dépôt des candidatures (18 octobre 2026, fin de journée)
const DATE_LIMITE = new Date('2026-10-18T23:59:59');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// --- Authentification de l'espace admin (vraie page de connexion + session) ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET non défini dans .env : une valeur aléatoire est utilisée pour cette exécution (les sessions seront invalidées à chaque redémarrage).');
}

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000, // 8 heures
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

function requireAdminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    // Sécurité : si aucun mot de passe n'est défini dans l'environnement,
    // on bloque l'accès plutôt que de laisser l'espace admin ouvert.
    return res.status(500).send(
      "Accès admin non configuré : définissez ADMIN_USER et ADMIN_PASSWORD dans le fichier .env avant de déployer."
    );
  }
  if (req.session && req.session.estAdmin) {
    return next();
  }
  return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
}

app.get('/admin/login', (req, res) => {
  if (req.session && req.session.estAdmin) {
    return res.redirect('/admin/candidatures');
  }
  res.render('admin-login', { erreur: null, next: req.query.next || '/admin/candidatures' });
});

app.post('/admin/login', (req, res) => {
  const { identifiant, mot_de_passe, next } = req.body;
  const destination = next && next.startsWith('/admin') ? next : '/admin/candidatures';

  if (!ADMIN_PASSWORD) {
    return res.status(500).send("Accès admin non configuré : définissez ADMIN_USER et ADMIN_PASSWORD dans le fichier .env.");
  }

  if (identifiant === ADMIN_USER && mot_de_passe === ADMIN_PASSWORD) {
    req.session.regenerate((err) => {
      if (err) return res.render('admin-login', { erreur: "Erreur de session, réessayez.", next: destination });
      req.session.estAdmin = true;
      req.session.save(() => res.redirect(destination));
    });
    return;
  }

  res.render('admin-login', { erreur: "Identifiant ou mot de passe incorrect.", next: destination });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

app.use('/uploads', requireAdminAuth, express.static(path.join(process.env.DATA_DIR || __dirname, 'uploads')));

// --- Configuration Multer (upload des pièces) ---
const uploadDir = path.join(process.env.DATA_DIR || __dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const suffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + suffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const typesAutorises = /jpeg|jpg|png|pdf/;
  const extOk = typesAutorises.test(path.extname(file.originalname).toLowerCase());
  if (extOk) return cb(null, true);
  cb(new Error('Format de fichier non autorisé (jpg, png, pdf uniquement).'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5 Mo max par fichier
});

const uploadFields = upload.fields([
  { name: 'fichier_carte_etudiant', maxCount: 1 },
  { name: 'fichier_cni', maxCount: 1 },
  { name: 'fichier_lettre_motivation', maxCount: 1 },
  { name: 'fichier_preuve_paiement', maxCount: 1 }
]);

// --- Routes ---
app.get('/', (req, res) => {
  res.render('accueil');
});

app.get('/candidature', (req, res) => {
  const cloturee = new Date() > DATE_LIMITE;
  res.render('form', { erreur: null, cloturee, dateLimite: DATE_LIMITE });
});

app.post('/candidater', (req, res) => {
  if (new Date() > DATE_LIMITE) {
    return res.render('form', { erreur: "Les candidatures sont closes depuis le 18 octobre 2026.", cloturee: true, dateLimite: DATE_LIMITE });
  }

  uploadFields(req, res, (err) => {
    if (err) {
      return res.render('form', { erreur: err.message, cloturee: false, dateLimite: DATE_LIMITE });
    }

    const requis = ['fichier_carte_etudiant', 'fichier_cni', 'fichier_lettre_motivation', 'fichier_preuve_paiement'];
    for (const champ of requis) {
      if (!req.files || !req.files[champ]) {
        return res.render('form', { erreur: "Merci de joindre toutes les pièces demandées.", cloturee: false, dateLimite: DATE_LIMITE });
      }
    }

    const {
      nom_complet, numero_carte, filiere, telephone, email,
      section, experience, motivation, numero_paiement
    } = req.body;

    const stmt = db.prepare(`
      INSERT INTO candidatures
      (nom_complet, numero_carte, filiere, telephone, email, section, experience, motivation, numero_paiement,
       fichier_carte_etudiant, fichier_cni, fichier_lettre_motivation, fichier_preuve_paiement)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      nom_complet, numero_carte, filiere, telephone, email, section, experience || '', motivation, numero_paiement,
      req.files.fichier_carte_etudiant[0].filename,
      req.files.fichier_cni[0].filename,
      req.files.fichier_lettre_motivation[0].filename,
      req.files.fichier_preuve_paiement[0].filename
    );

    res.render('merci', { nom: nom_complet });
  });
});

// --- Supprimer une candidature (et ses fichiers) ---
app.post('/admin/candidature/:id/supprimer', requireAdminAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM candidatures WHERE id = ?').get(req.params.id);
  if (!c) return res.redirect('/admin/candidatures');

  CHAMPS_FICHIERS.forEach(champ => {
    const nomFichier = c[champ.cle];
    if (!nomFichier) return;
    const cheminDisque = path.join(uploadDir, nomFichier);
    if (fs.existsSync(cheminDisque)) fs.unlinkSync(cheminDisque);
  });

  db.prepare('DELETE FROM candidatures WHERE id = ?').run(req.params.id);
  res.redirect('/admin/candidatures');
});

// --- Espace admin pour consulter les candidatures reçues ---
app.get('/admin/candidatures', requireAdminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM candidatures ORDER BY date_soumission DESC').all();

  const parSection = {};
  rows.forEach(c => {
    parSection[c.section] = (parSection[c.section] || 0) + 1;
  });

  const aujourdHui = new Date();
  const il_y_a_7_jours = new Date(aujourdHui.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentes = rows.filter(c => new Date(c.date_soumission) >= il_y_a_7_jours).length;

  res.render('admin', {
    candidatures: rows,
    total: rows.length,
    parSection,
    recentes
  });
});

// --- Colonnes communes aux exports ---
const COLONNES_EXPORT = [
  { cle: 'nom_complet', titre: 'Nom complet' },
  { cle: 'numero_carte', titre: 'N° carte' },
  { cle: 'section', titre: 'Section' },
  { cle: 'filiere', titre: 'Filière' },
  { cle: 'telephone', titre: 'Téléphone' },
  { cle: 'email', titre: 'Email' },
  { cle: 'numero_paiement', titre: 'N° paiement' },
  { cle: 'date_soumission', titre: 'Reçue le' }
];

// --- Export PDF des candidatures ---
app.get('/admin/export.pdf', requireAdminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM candidatures ORDER BY date_soumission DESC').all();

  const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="candidatures-${Date.now()}.pdf"`);
  doc.pipe(res);

  const largeurs = [110, 65, 75, 90, 80, 130, 85, 95]; // doit correspondre à COLONNES_EXPORT
  const xDepart = doc.page.margins.left;
  const largeurDispo = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  function entete() {
    doc.fillColor('#0E1B33').font('Helvetica-Bold').fontSize(15)
      .text("L'Œil du Campus — Candidatures reçues", xDepart, doc.y);
    doc.fillColor('#5A6478').font('Helvetica').fontSize(9)
      .text(`${rows.length} candidature(s) — généré le ${new Date().toLocaleString('fr-FR')}`);
    doc.moveDown(0.8);
    ligneEntete();
  }

  function ligneEntete() {
    const y = doc.y;
    doc.rect(xDepart, y, largeurDispo, 20).fill('#0E1B33');
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8);
    let x = xDepart;
    COLONNES_EXPORT.forEach((col, i) => {
      doc.text(col.titre, x + 4, y + 6, { width: largeurs[i] - 8, ellipsis: true });
      x += largeurs[i];
    });
    doc.y = y + 20;
    doc.fillColor('#17203A').font('Helvetica').fontSize(8);
  }

  entete();

  rows.forEach((c, index) => {
    const hauteurLigne = 20;
    if (doc.y + hauteurLigne > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      ligneEntete();
    }
    const y = doc.y;
    if (index % 2 === 0) doc.rect(xDepart, y, largeurDispo, hauteurLigne).fill('#F5F2E8');
    doc.fillColor('#17203A').font('Helvetica').fontSize(8);
    let x = xDepart;
    COLONNES_EXPORT.forEach((col, i) => {
      const valeur = col.cle === 'date_soumission'
        ? new Date(c[col.cle]).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : (c[col.cle] || '');
      doc.text(String(valeur), x + 4, y + 6, { width: largeurs[i] - 8, ellipsis: true });
      x += largeurs[i];
    });
    doc.y = y + hauteurLigne;
  });

  doc.end();
});

// --- Export Word (.docx) des candidatures ---
app.get('/admin/export.docx', requireAdminAuth, async (req, res) => {
  const rows = db.prepare('SELECT * FROM candidatures ORDER BY date_soumission DESC').all();

  const celluleEntete = (texte) => new TableCell({
    shading: { fill: '0E1B33' },
    children: [new Paragraph({ children: [new TextRun({ text: texte, bold: true, color: 'FFFFFF', size: 18 })] })]
  });

  const celluleTexte = (texte) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text: String(texte ?? ''), size: 18 })] })]
  });

  const ligneEntete = new TableRow({
    tableHeader: true,
    children: COLONNES_EXPORT.map(col => celluleEntete(col.titre))
  });

  const lignesDonnees = rows.map(c => new TableRow({
    children: COLONNES_EXPORT.map(col => {
      const valeur = col.cle === 'date_soumission'
        ? new Date(c[col.cle]).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : c[col.cle];
      return celluleTexte(valeur);
    })
  }));

  const document = new Document({
    sections: [{
      properties: { page: { size: { orientation: 'landscape' } } },
      children: [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "L'Œil du Campus — Candidatures reçues", bold: true, color: '0E1B33' })]
        }),
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: `${rows.length} candidature(s) — généré le ${new Date().toLocaleString('fr-FR')}`, color: '5A6478', size: 20 })]
        }),
        new Paragraph({ text: '' }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [ligneEntete, ...lignesDonnees]
        })
      ]
    }]
  });

  const buffer = await Packer.toBuffer(document);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="candidatures-${Date.now()}.docx"`);
  res.send(buffer);
});

// --- Export des documents joints (zip) ---
function nomDossierCandidat(c) {
  const base = c.nom_complet
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${base || 'candidat'}_${c.id}`;
}

const CHAMPS_FICHIERS = [
  { cle: 'fichier_carte_etudiant', label: 'carte_etudiant' },
  { cle: 'fichier_cni', label: 'cni' },
  { cle: 'fichier_lettre_motivation', label: 'lettre_motivation' },
  { cle: 'fichier_preuve_paiement', label: 'preuve_paiement' }
];

function ajouterFichiersCandidat(archive, c, prefixeDossier) {
  CHAMPS_FICHIERS.forEach(champ => {
    const nomFichier = c[champ.cle];
    if (!nomFichier) return;
    const cheminDisque = path.join(uploadDir, nomFichier);
    if (fs.existsSync(cheminDisque)) {
      const extension = path.extname(nomFichier);
      archive.file(cheminDisque, { name: `${prefixeDossier}/${champ.label}${extension}` });
    }
  });
}

// Tous les documents de toutes les candidatures, un dossier par candidat
app.get('/admin/export-fichiers.zip', requireAdminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM candidatures ORDER BY date_soumission DESC').all();

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="documents-candidatures-${Date.now()}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { throw err; });
  archive.pipe(res);

  rows.forEach(c => ajouterFichiersCandidat(archive, c, nomDossierCandidat(c)));

  archive.finalize();
});

// Les 4 documents d'une seule candidature
app.get('/admin/candidature/:id/fichiers.zip', requireAdminAuth, (req, res) => {
  const c = db.prepare('SELECT * FROM candidatures WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).send('Candidature introuvable.');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="documents-${nomDossierCandidat(c)}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { throw err; });
  archive.pipe(res);

  ajouterFichiersCandidat(archive, c, nomDossierCandidat(c));

  archive.finalize();
});

// --- Export CSV des candidatures ---
app.get('/admin/export.csv', requireAdminAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM candidatures ORDER BY date_soumission DESC').all();

  const colonnes = [
    'id', 'nom_complet', 'numero_carte', 'filiere', 'telephone', 'email', 'section',
    'experience', 'motivation', 'numero_paiement', 'date_soumission'
  ];

  const echapper = (val) => {
    const s = (val === null || val === undefined) ? '' : String(val);
    return `"${s.replace(/"/g, '""')}"`;
  };

  const lignes = [colonnes.join(',')];
  rows.forEach(c => {
    lignes.push(colonnes.map(col => echapper(c[col])).join(','));
  });

  const csv = '\uFEFF' + lignes.join('\r\n'); // BOM pour un bon affichage des accents dans Excel

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="candidatures-${Date.now()}.csv"`);
  res.send(csv);
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
