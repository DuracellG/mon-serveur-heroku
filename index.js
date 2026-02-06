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

// ==================== MIGRATION & INITIALISATION ROBUSTE ====================
async function initDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Vérification et initialisation de la base de données...');
    
    // ÉTAPE 1 : Supprimer les anciennes tables si elles existent (migration propre)
    await client.query('DROP TABLE IF EXISTS notes CASCADE');
    await client.query('DROP TABLE IF EXISTS etudiants CASCADE');
    console.log('✅ Anciennes tables supprimées');
    
    // ÉTAPE 2 : Créer la table étudiants
    await client.query(`
      CREATE TABLE etudiants (
        id SERIAL PRIMARY KEY,
        nom VARCHAR(100) NOT NULL,
        prenom VARCHAR(100) NOT NULL,
        classe VARCHAR(50),
        date_naissance DATE,
        matricule VARCHAR(50) UNIQUE NOT NULL,
        date_inscription TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table étudiants créée');
    
    // ÉTAPE 3 : Créer la table notes
    await client.query(`
      CREATE TABLE notes (
        id SERIAL PRIMARY KEY,
        etudiant_id INTEGER NOT NULL REFERENCES etudiants(id) ON DELETE CASCADE,
        matiere VARCHAR(100) NOT NULL,
        note DECIMAL(5,2) NOT NULL CHECK (note >= 0 AND note <= 20),
        coefficient INTEGER DEFAULT 1 CHECK (coefficient >= 1 AND coefficient <= 10),
        date_ajout TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table notes créée');
    
    // ÉTAPE 4 : Créer des index pour améliorer les performances
    await client.query('CREATE INDEX idx_notes_etudiant_id ON notes(etudiant_id)');
    await client.query('CREATE INDEX idx_etudiants_matricule ON etudiants(matricule)');
    await client.query('CREATE INDEX idx_etudiants_nom ON etudiants(nom, prenom)');
    console.log('✅ Index créés');
    
    console.log('✅ Base de données initialisée avec succès');
  } catch (err) {
    console.error('❌ Erreur lors de l\'initialisation de la base de données:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Initialiser au démarrage
initDatabase().catch(err => {
  console.error('❌ Impossible d\'initialiser la base de données:', err);
  process.exit(1);
});

// ==================== ROUTES ÉTUDIANTS ====================

// Créer un étudiant
app.post('/api/etudiants', async (req, res) => {
  const { nom, prenom, classe, date_naissance, matricule } = req.body;
  
  // Validation
  if (!nom || !prenom || !matricule) {
    return res.status(400).json({ 
      success: false, 
      error: 'Nom, prénom et matricule sont obligatoires' 
    });
  }
  
  try {
    const result = await pool.query(
      `INSERT INTO etudiants (nom, prenom, classe, date_naissance, matricule) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING *`,
      [
        nom.trim(), 
        prenom.trim(), 
        classe || null, 
        date_naissance || null, 
        matricule.trim().toUpperCase()
      ]
    );
    
    console.log(`✅ Étudiant inscrit: ${nom} ${prenom} (${matricule})`);
    res.json({ success: true, etudiant: result.rows[0] });
  } catch (err) {
    console.error('❌ Erreur insertion étudiant:', err.message);
    
    if (err.code === '23505') { // Contrainte unique violée
      res.status(400).json({ 
        success: false, 
        error: 'Ce matricule existe déjà' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Erreur lors de l\'inscription' 
      });
    }
  }
});

// Obtenir tous les étudiants avec leurs moyennes
app.get('/api/etudiants', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        e.id,
        e.nom,
        e.prenom,
        e.classe,
        e.date_naissance,
        e.matricule,
        e.date_inscription,
        COUNT(n.id) as nombre_notes,
        ROUND(AVG(n.note * n.coefficient) / NULLIF(AVG(n.coefficient), 0), 2) as moyenne
      FROM etudiants e
      LEFT JOIN notes n ON e.id = n.etudiant_id
      GROUP BY e.id
      ORDER BY e.nom ASC, e.prenom ASC
    `);
    
    console.log(`✅ ${result.rows.length} étudiants chargés`);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Erreur récupération étudiants:', err.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la récupération des étudiants' 
    });
  }
});

// Obtenir un étudiant par ID avec ses notes
app.get('/api/etudiants/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      success: false, 
      error: 'ID invalide' 
    });
  }
  
  try {
    // Récupérer l'étudiant
    const etudiantResult = await pool.query(
      'SELECT * FROM etudiants WHERE id = $1',
      [id]
    );
    
    if (etudiantResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Étudiant non trouvé' 
      });
    }
    
    // Récupérer les notes
    const notesResult = await pool.query(
      'SELECT * FROM notes WHERE etudiant_id = $1 ORDER BY date_ajout DESC',
      [id]
    );
    
    res.json({
      success: true,
      etudiant: etudiantResult.rows[0],
      notes: notesResult.rows
    });
  } catch (err) {
    console.error('❌ Erreur récupération étudiant:', err.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la récupération' 
    });
  }
});

// Supprimer un étudiant
app.delete('/api/etudiants/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      success: false, 
      error: 'ID invalide' 
    });
  }
  
  try {
    const result = await pool.query(
      'DELETE FROM etudiants WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Étudiant non trouvé' 
      });
    }
    
    console.log(`✅ Étudiant supprimé: ID ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Erreur suppression étudiant:', err.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la suppression' 
    });
  }
});

// ==================== ROUTES NOTES ====================

// Ajouter une note
app.post('/api/notes', async (req, res) => {
  const { etudiant_id, matiere, note, coefficient } = req.body;
  
  // Validation
  if (!etudiant_id || !matiere || note === undefined) {
    return res.status(400).json({ 
      success: false, 
      error: 'Étudiant, matière et note sont obligatoires' 
    });
  }
  
  if (note < 0 || note > 20) {
    return res.status(400).json({ 
      success: false, 
      error: 'La note doit être entre 0 et 20' 
    });
  }
  
  const coef = coefficient || 1;
  if (coef < 1 || coef > 10) {
    return res.status(400).json({ 
      success: false, 
      error: 'Le coefficient doit être entre 1 et 10' 
    });
  }
  
  try {
    // Vérifier que l'étudiant existe
    const etudiantCheck = await pool.query(
      'SELECT id FROM etudiants WHERE id = $1',
      [etudiant_id]
    );
    
    if (etudiantCheck.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Étudiant non trouvé' 
      });
    }
    
    // Insérer la note
    const result = await pool.query(
      `INSERT INTO notes (etudiant_id, matiere, note, coefficient) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [etudiant_id, matiere.trim(), parseFloat(note), parseInt(coef)]
    );
    
    console.log(`✅ Note ajoutée: ${matiere} - ${note}/20 (coef ${coef})`);
    res.json({ success: true, note: result.rows[0] });
  } catch (err) {
    console.error('❌ Erreur ajout note:', err.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de l\'ajout de la note' 
    });
  }
});

// Obtenir toutes les notes
app.get('/api/notes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        n.*,
        e.nom,
        e.prenom,
        e.classe,
        e.matricule
      FROM notes n
      INNER JOIN etudiants e ON n.etudiant_id = e.id
      ORDER BY n.date_ajout DESC
    `);
    
    console.log(`✅ ${result.rows.length} notes chargées`);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Erreur récupération notes:', err.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la récupération des notes' 
    });
  }
});

// Supprimer une note
app.delete('/api/notes/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      success: false, 
      error: 'ID invalide' 
    });
  }
  
  try {
    const result = await pool.query(
      'DELETE FROM notes WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Note non trouvée' 
      });
    }
    
    console.log(`✅ Note supprimée: ID ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Erreur suppression note:', err.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la suppression' 
    });
  }
});

// ==================== EXPORT ====================

// Export données étudiant pour Excel
app.get('/api/export/etudiant/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!id || isNaN(id)) {
    return res.status(400).json({ 
      success: false, 
      error: 'ID invalide' 
    });
  }
  
  try {
    const etudiantResult = await pool.query(
      'SELECT * FROM etudiants WHERE id = $1',
      [id]
    );
    
    if (etudiantResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Étudiant non trouvé' 
      });
    }
    
    const notesResult = await pool.query(
      'SELECT * FROM notes WHERE etudiant_id = $1 ORDER BY matiere ASC',
      [id]
    );
    
    res.json({
      success: true,
      etudiant: etudiantResult.rows[0],
      notes: notesResult.rows
    });
  } catch (err) {
    console.error('❌ Erreur export:', err.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de l\'export' 
    });
  }
});

// ==================== ROUTES PRINCIPALES ====================

// Page d'accueil
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'ok', 
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'error', 
      database: 'disconnected',
      error: err.message 
    });
  }
});

// Gestion des erreurs 404
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Route non trouvée' 
  });
});

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error('❌ Erreur non gérée:', err);
  res.status(500).json({ 
    success: false, 
    error: 'Erreur serveur interne' 
  });
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur PIGIER démarré sur le port ${PORT}`);
  console.log(`📅 Date: ${new Date().toLocaleString('fr-FR')}`);
});

// Gestion propre de l'arrêt
process.on('SIGTERM', async () => {
  console.log('⚠️ Arrêt du serveur...');
  await pool.end();
  process.exit(0);
});