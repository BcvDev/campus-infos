const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'candidatures.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS candidatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom_complet TEXT NOT NULL,
    numero_carte TEXT NOT NULL,
    filiere TEXT NOT NULL,
    telephone TEXT NOT NULL,
    email TEXT NOT NULL,
    section TEXT NOT NULL,
    experience TEXT,
    motivation TEXT NOT NULL,
    numero_paiement TEXT NOT NULL,
    fichier_carte_etudiant TEXT,
    fichier_cni TEXT,
    fichier_lettre_motivation TEXT,
    fichier_preuve_paiement TEXT,
    date_soumission TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

module.exports = db;
