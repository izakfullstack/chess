# Chess Tournament Website - Architecture Plan

## Project Overview
A full-stack chess tournament platform where:
- Each user gets a 6-digit account number
- Users can create/open games
- Each player has a rating that updates after every game
- Users can view all games and move history
- Game board can be navigated forward/backward through moves

## Tech Stack
- **Backend**: Node.js + Express + PostgreSQL
- **Frontend**: HTML + CSS + JavaScript (vanilla, no frameworks needed)
- **Storage**: PostgreSQL database (chess_tournament)

## Project Structure
```
chess-tournament/
├── backend/
│   ├── server.js          # Express server
│   ├── database.js        # PostgreSQL setup
│   ├── routes/
│   │   ├── users.js       # User registration, login
│   │   ├── games.js       # Game creation, moves, results
│   │   └── ratings.js     # Rating updates
│   └── models/
│       ├── User.js        # User model
│       ├── Game.js        # Game model
│       └── Rating.js      # Rating system
├── frontend/
│   ├── index.html         # Main page
│   ├── css/
│   │   └── style.css     # Styles
│   ├── js/
│   │   ├── auth.js       # Auth logic
│   │   ├── game.js       # Chess board rendering
│   │   ├── games.js      # Games list
│   │   └── rating.js     # Rating display
│   └── assets/
└── README.md             # Instructions
```

## Database Schema

### Users Table
- id (INTEGER PRIMARY KEY)
- account_number (TEXT UNIQUE, 6 digits)
- created_at (DATETIME)

### Games Table
- id (INTEGER PRIMARY KEY)
- player1_id (INTEGER, references users)
- player2_id (INTEGER, references users)
- winner_id (INTEGER, nullable)
- status (TEXT: 'pending', 'active', 'completed')
- created_at (DATETIME)
- completed_at (DATETIME, nullable)

### Moves Table
- id (INTEGER PRIMARY KEY)
- game_id (INTEGER, references games)
- move_number (INTEGER)
- from_square (TEXT)
- to_square (TEXT)
- piece (TEXT)
- color (TEXT: 'white' or 'black')
- created_at (DATETIME)

### Ratings Table
- user_id (INTEGER PRIMARY KEY, references users)
- rating (INTEGER, default 1200)
- games_played (INTEGER, default 0)
- wins (INTEGER, default 0)
- losses (INTEGER, default 0)

## API Endpoints

### Users
- POST /api/users/register - Create new user (auto-generate 6-digit account number)
- POST /api/users/login - Login with account number
- GET /api/users/:id - Get user profile with rating

### Games
- POST /api/games - Create new game (player1 creates, optionally invite player2)
- GET /api/games - List all games (with filters)
- GET /api/games/:id - Get game details with moves
- POST /api/games/:id/move - Make a move
- POST /api/games/:id/complete - Complete game with winner

### Ratings
- GET /api/ratings/:userId - Get rating history
- POST /api/ratings/update - Update rating after game (internal)

## Rating System (Elo)
- Starting rating: 1200
- K-factor: 32 (how much rating changes per game)
- Expected score formula: 1 / (1 + 10^((ratingOpponent - ratingPlayer)/400))
- Rating change: K * (actualScore - expectedScore)
- After each game, both players' ratings update

## Frontend Features
1. **Landing Page**: Explanation of the platform
2. **Register/Login**: Simple 6-digit account number system
3. **Dashboard**: View all games, current rating, create new game
4. **Game Board**: Interactive chess board with piece dragging
5. **Move History**: List of all moves with navigation (prev/next)
6. **Game Replay**: Navigate through moves to see board state at any point

## AI/ML Concepts to Teach Along the Way
1. **Reinforcement Learning** - How chess engines learn (AlphaZero style)
2. **Neural Networks** - How they evaluate board positions
3. **Search Algorithms** - Minimax, Monte Carlo Tree Search
4. **Training Data** - How games become training examples
5. **Model Evaluation** - How to measure chess AI strength
6. **Feature Engineering** - What makes a good board representation
7. **Overfitting** - Why AIs sometimes play poorly in certain positions

## Implementation Steps
1. Create project structure and package.json
2. Build backend with Express + PostgreSQL
3. Implement user registration and login
4. Implement game creation and move tracking
5. Implement rating system
6. Build frontend with chess board
7. Integrate frontend with backend
8. Test all features
9. Add AI/ML educational content