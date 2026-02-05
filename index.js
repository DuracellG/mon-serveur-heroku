const express = require('express');
const { Pool } = require('pg');
const bodyParser = require('body-parser');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuration PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// Initialiser la base de données
async function initDatabase() {
  try {
    // Table étudiants
    await pool.query(`
      CREATE TABLE IF NOT EXISTS etudiants (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100) NOT NULL,
        classe VARCHAR(50),
        date_naissance DATE,
        matricule VARCHAR(20) UNIQUE,
        date_inscription TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Table notes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        etudiant_id INTEGER REFERENCES etudiants(id) ON DELETE CASCADE,
        matiere VARCHAR(100) NOT NULL,
        note DECIMAL(5,2) NOT NULL,
        coefficient INTEGER DEFAULT 1,
        date_ajout TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Base de données initialisée');
  } catch (err) {
    console.error('❌ Erreur initialisation BD:', err);
  }
}

initDatabase();

// ==================== ROUTES ÉTUDIANTS ====================

// Créer un étudiant
app.post('/api/etudiants', async (req, res) => {
  const { nom, prenom, classe, date_naissance, matricule } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO etudiants (nom, prenom, classe, date_naissance, matricule) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nom, prenom, classe, date_naissance, matricule]
    );
    res.json({ success: true, etudiant: result.rows[0] });
  } catch (err) {
    console.error(err);
    if (err.code === '23505') { // Code erreur PostgreSQL pour duplicata
      res.status(400).json({ success: false, error: 'Ce matricule existe déjà' });
    } else {
      res.status(500).json({ success: false, error: 'Erreur lors de l\'inscription' });
    }
  }
});

// Obtenir tous les étudiants (ordre alphabétique)
app.get('/api/etudiants', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, 
             COUNT(n.id) as nombre_notes,
             ROUND(AVG(n.note), 2) as moyenne
      FROM etudiants e
      LEFT JOIN notes n ON e.id = n.etudiant_id
      GROUP BY e.id
      ORDER BY e.nom ASC, e.prenom ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

// Obtenir un étudiant par ID avec ses notes
app.get('/api/etudiants/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Info étudiant
    const etudiant = await pool.query(
      'SELECT * FROM etudiants WHERE id = $1',
      [id]
    );
    
    if (etudiant.rows.length === 0) {
      return res.status(404).json({ error: 'Étudiant non trouvé' });
    }
    
    // Notes de l'étudiant
    const notes = await pool.query(
      'SELECT * FROM notes WHERE etudiant_id = $1 ORDER BY date_ajout DESC',
      [id]
    );
    
    res.json({
      etudiant: etudiant.rows[0],
      notes: notes.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

// Supprimer un étudiant
app.delete('/api/etudiants/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    await pool.query('DELETE FROM etudiants WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur lors de la suppression' });
  }
});

// ==================== ROUTES NOTES ====================

// Ajouter une note à un étudiant
app.post('/api/notes', async (req, res) => {
  const { etudiant_id, matiere, note, coefficient } = req.body;
  
  try {
    const result = await pool.query(
      `INSERT INTO notes (etudiant_id, matiere, note, coefficient) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [etudiant_id, matiere, note, coefficient || 1]
    );
    res.json({ success: true, note: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur lors de l\'ajout' });
  }
});

// Obtenir toutes les notes
app.get('/api/notes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.*, e.nom, e.prenom, e.classe, e.matricule
      FROM notes n
      JOIN etudiants e ON n.etudiant_id = e.id
      ORDER BY n.date_ajout DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

// Supprimer une note
app.delete('/api/notes/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    await pool.query('DELETE FROM notes WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur lors de la suppression' });
  }
});

// ==================== EXPORT ====================

// Export données étudiant (JSON pour conversion en Excel côté client)
app.get('/api/export/etudiant/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const etudiant = await pool.query(
      'SELECT * FROM etudiants WHERE id = $1',
      [id]
    );
    
    const notes = await pool.query(
      'SELECT * FROM notes WHERE etudiant_id = $1 ORDER BY matiere ASC',
      [id]
    );
    
    res.json({
      etudiant: etudiant.rows[0],
      notes: notes.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de l\'export' });
  }
});

// Route page d'accueil
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
});