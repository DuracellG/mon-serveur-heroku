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

// Créer la table au démarrage si elle n'existe pas
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100) NOT NULL,
        matiere VARCHAR(100) NOT NULL,
        note DECIMAL(5,2) NOT NULL,
        date_ajout TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Base de données initialisée');
  } catch (err) {
    console.error('Erreur initialisation BD:', err);
  }
}

initDatabase();

// Route page d'accueil
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Route pour ajouter une note
app.post('/api/notes', async (req, res) => {
  const { nom, prenom, matiere, note } = req.body;
  
  try {
    const result = await pool.query(
      'INSERT INTO notes (nom, prenom, matiere, note) VALUES ($1, $2, $3, $4) RETURNING *',
      [nom, prenom, matiere, note]
    );
    res.json({ success: true, note: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Erreur lors de l\'ajout' });
  }
});

// Route pour obtenir toutes les notes
app.get('/api/notes', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notes ORDER BY date_ajout DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur lors de la récupération' });
  }
});

// Route pour supprimer une note
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

app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});