/**
 * Main server file - Express server for Chess Tournament Platform
 * 
 * AI/ML Concept #1: Why use a server?
 * 
 * In modern AI applications, the "backend" is where your model lives.
 * For chess AIs like AlphaZero or Stockfish:
 * - The neural network weights are stored here
 * - The search algorithm (MCTS/Minimax) runs here
 * - Game state is managed here
 * - The frontend is just a display layer
 * 
 * This is the same architecture - backend does the "thinking",
 * frontend just shows results to the user.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Import routes
const usersRoutes = require('./routes/users');
const gamesRoutes = require('./routes/games');
const adminRoutes = require('./routes/admin');

// Use routes
app.use('/api/users', usersRoutes);
app.use('/api/games', gamesRoutes);
app.use('/api/admin', adminRoutes);

// Serve frontend for all other routes (SPA support)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Chess Tournament Server running on http://localhost:${PORT}`);
    console.log(`Frontend available at http://localhost:${PORT}`);
});
// t2
