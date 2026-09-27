require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Date limite de dépôt des candidatures (18 octobre 2026, fin de journée)
const DATE_LIMITE = new Date('2026-10-18T23:59:59');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

// --- Authentification basique pour l'espace admin (et les fichiers uploadés) ---
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function requireAdminAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    // Sécurité : si aucun mot de passe n'est défini dans l'environnement,
    // on bloque l'accès plutôt que de laisser l'espace admin ouvert.
    return res.status(500).send(
      "Accès admin non configuré : définissez ADMIN_USER et ADMIN_PASSWORD dans le fichier .env avant de déployer."
    );
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const [user, password] = Buffer.from(encoded, 'base64').toString().split(':');
    if (user === ADMIN_USER && password === ADMIN_PASSWORD) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Espace admin"');
  return res.status(401).send('Authentification requise.');
}

app.use('/uploads', requireAdminAuth, express.static(path.join(__dirname, 'uploads')));

// --- Configuration Multer (upload des pièces) ---
const uploadDir = path.join(__dirname, 'uploads');
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
