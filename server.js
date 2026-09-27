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
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // à protéger par mot de passe en production

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

// --- Petit espace admin pour consulter les candidatures reçues ---
app.get('/admin/candidatures', (req, res) => {
  const rows = db.prepare('SELECT * FROM candidatures ORDER BY date_soumission DESC').all();
  res.render('admin', { candidatures: rows });
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
