/**
 * Rating system module - handles Elo rating calculations and display
 * 
 * AI/ML Concept #7: Evaluation functions
 * 
 * In chess AI, evaluation functions are crucial for:
 * - Assessing board positions
 * - Making decisions about moves
 * - Predicting game outcomes
 * 
 * Our rating system uses the Elo formula, which is:
 * - Simple yet effective
 * - Widely used in competitive games
 * - Mathematically sound for skill assessment
 * 
 * The Elo system is perfect for teaching because it shows:
 * - How probability relates to skill difference
 * - Why ratings change after each game
 * - How to balance fairness in competition
 */

const RATING_K_FACTOR = 32; // How much rating changes per game
const RATING_START = 1200; // Starting rating for new players

/**
 * Calculate expected score for a player based on rating difference
 * 
 * This is the core of the Elo system.
 * Expected score = 1 / (1 + 10^((opponentRating - playerRating)/400))
 * 
 * AI/ML Concept: Probability calculation
 * - Shows how rating difference predicts win probability
 * - Used in chess engines for move evaluation
 * - Similar to softmax in neural networks
 */
function calculateExpectedScore(playerRating, opponentRating) {
    const ratingDifference = opponentRating - playerRating;
    return 1 / (1 + Math.pow(10, ratingDifference / 400));
}

/**
 * Calculate new rating after a game using Elo formula
 * 
 * New rating = Old rating + K * (Actual score - Expected score)
 * 
 * AI/ML Concept: Gradient descent
 * - Adjusts ratings based on performance vs expectation
 * - Similar to updating neural network weights
 * - Moves toward more accurate skill representation
 */
function calculateNewRating(currentRating, opponentRating, actualScore) {
    const expectedScore = calculateExpectedScore(currentRating, opponentRating);
    const ratingChange = RATING_K_FACTOR * (actualScore - expectedScore);
    return Math.round(currentRating + ratingChange);
}

/**
 * Determine rating change after a game
 * 
 * AI/ML Concept: Outcome analysis
 * - Win/loss/draw affects rating differently
 * - Shows how results impact skill assessment
 * - Similar to reinforcement learning rewards
 */
function getRatingChange(currentRating, opponentRating, result) {
    let actualScore;

    switch (result.toLowerCase()) {
        case 'win':
            actualScore = 1;
            break;
        case 'loss':
            actualScore = 0;
            break;
        case 'draw':
            actualScore = 0.5;
            break;
        default:
            actualScore = 0.5; // Default to draw
    }

    return calculateNewRating(currentRating, opponentRating, actualScore) - currentRating;
}

/**
 * Get rating class for CSS styling based on rating level
 * 
 * AI/ML Concept: Classification
 * - Groups ratings into meaningful categories
 * - Used in chess engines for position evaluation
 * - Similar to clustering in machine learning
 */
function getRatingClass(rating) {
    if (rating >= 2200) return 'rating-excellent';
    if (rating >= 1800) return 'rating-good';
    if (rating >= 1400) return 'rating-average';
    if (rating >= 1000) return 'rating-poor';
    return 'rating-terrible';
}

/**
 * Get rating level description
 * 
 * AI/ML Concept: Feature engineering
 * - Converts numerical ratings to human-readable labels
 * - Used in chess engines for position analysis
 * - Similar to one-hot encoding in ML
 */
function getRatingLevel(rating) {
    if (rating >= 2200) return 'Grandmaster';
    if (rating >= 1800) return 'Expert';
    if (rating >= 1400) return 'Intermediate';
    if (rating >= 1000) return 'Beginner';
    return 'New Player';
}

/**
 * Calculate rating statistics for a player
 * 
 * AI/ML Concept: Statistical analysis
 * - Computes mean, variance, and other metrics
 * - Used in chess engines for performance analysis
 * - Similar to data analysis in ML pipelines
 */
function calculateRatingStats(games) {
    if (games.length === 0) {
        return {
            averageRating: RATING_START,
            bestRating: RATING_START,
            worstRating: RATING_START,
            gamesPlayed: 0,
            winRate: 0,
            ratingTrend: 'stable'
        };
    }

    const ratings = games.map(game => game.newRating || game.rating);
    const averageRating = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
    const bestRating = Math.max(...ratings);
    const worstRating = Math.min(...ratings);

    const wins = games.filter(game => game.result === 'win').length;
    const winRate = (wins / games.length) * 100;

    // Calculate rating trend (last 5 games vs first 5 games)
    const recentGames = games.slice(-5);
    const olderGames = games.slice(0, Math.min(5, games.length - 5));

    let ratingTrend = 'stable';
    if (recentGames.length > 0 && olderGames.length > 0) {
        const recentAvg = recentGames.reduce((sum, game) => sum + (game.newRating || game.rating), 0) / recentGames.length;
        const olderAvg = olderGames.reduce((sum, game) => sum + (game.newRating || game.rating), 0) / olderGames.length;

        if (recentAvg > olderAvg + 50) ratingTrend = 'improving';
        else if (olderAvg > recentAvg + 50) ratingTrend = 'declining';
    }

    return {
        averageRating: Math.round(averageRating),
        bestRating: bestRating,
        worstRating: worstRating,
        gamesPlayed: games.length,
        winRate: Math.round(winRate),
        ratingTrend: ratingTrend
    };
}

/**
 * Format rating for display
 * 
 * AI/ML Concept: Data presentation
 * - Converts raw numbers to user-friendly format
 * - Used in chess engines for move evaluation display
 * - Similar to data visualization in ML
 */
function formatRating(rating) {
    return rating.toString().padStart(4, '0');
}

/**
 * Get color for rating display
 * 
 * AI/ML Concept: Feature visualization
 * - Maps numerical values to colors
 * - Used in chess engines for position evaluation
 * - Similar to heat maps in ML
 */
function getRatingColor(rating) {
    if (rating >= 2200) return '#10b981'; // green-500
    if (rating >= 1800) return '#3b82f6'; // blue-500
    if (rating >= 1400) return '#f59e0b'; // amber-500
    if (rating >= 1000) return '#ef4444'; // red-500
    return '#dc2626'; // red-600
}

/**
 * Calculate rating difference and color
 * 
 * AI/ML Concept: Comparative analysis
 * - Shows how ratings compare between players
 * - Used in chess engines for move selection
 * - Similar to feature comparison in ML
 */
function getRatingDifferenceColor(rating1, rating2) {
    const difference = rating2 - rating1;

    if (Math.abs(difference) >= 200) {
        return difference > 0 ? '#10b981' : '#ef4444'; // Strong advantage
    } else if (Math.abs(difference) >= 100) {
        return difference > 0 ? '#3b82f6' : '#f59e0b'; // Moderate advantage
    } else {
        return '#6b7280'; // Neutral
    }
}

/**
 * Create rating bar visualization
 * 
 * AI/ML Concept: Data visualization
 * - Converts rating to visual representation
 * - Used in chess engines for position evaluation
 * - Similar to progress bars in ML dashboards
 */
function createRatingBar(rating, maxRating = 2500) {
    const percentage = Math.min((rating / maxRating) * 100, 100);
    const ratingClass = getRatingClass(rating);

    return `
        <div class="rating-bar-container">
            <div class="rating-bar">
                <div class="rating-bar-fill" style="width: ${percentage}%; background-color: ${getRatingColor(rating)}"></div>
            </div>
            <span class="rating-value ${ratingClass}">${formatRating(rating)}</span>
        </div>
    `;
}

/**
 * Get rating change indicator
 * 
 * AI/ML Concept: Change detection
 * - Shows how ratings are changing over time
 * - Used in chess engines for move evaluation
 * - Similar to anomaly detection in ML
 */
function getRatingChangeIndicator(change) {
    if (change > 0) {
        return `<span class="rating-change positive">+${change}</span>`;
    } else if (change < 0) {
        return `<span class="rating-change negative">${change}</span>`;
    } else {
        return `<span class="rating-change stable">0</span>`;
    }
}

/**
 * Calculate rating volatility
 * 
 * AI/ML Concept: Volatility measurement
 * - Measures how much ratings fluctuate
 * - Used in chess engines for position evaluation
 * - Similar to variance in ML
 */
function calculateRatingVolatility(games, windowSize = 10) {
    if (games.length < 2) return 0;

    const recentGames = games.slice(-windowSize);
    const ratings = recentGames.map(game => game.newRating || game.rating);

    if (ratings.length < 2) return 0;

    const mean = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
    const variance = ratings.reduce((sum, rating) => sum + Math.pow(rating - mean, 2), 0) / ratings.length;

    return Math.sqrt(variance);
}

/**
 * Get rating stability assessment
 * 
 * AI/ML Concept: Stability analysis
 * - Assesses how stable a player's rating is
 * - Used in chess engines for position evaluation
 * - Similar to convergence analysis in ML
 */
function getRatingStability(volatility) {
    if (volatility <= 50) return 'very stable';
    if (volatility <= 100) return 'stable';
    if (volatility <= 200) return 'moderate';
    if (volatility <= 400) return 'volatile';
    return 'highly volatile';
}

/**
 * Calculate rating percentile
 * 
 * AI/ML Concept: Percentile ranking
 * - Shows how a rating compares to others
 * - Used in chess engines for position evaluation
 * - Similar to percentile ranking in ML
 */
function calculateRatingPercentile(rating, allRatings) {
    if (allRatings.length === 0) return 50;

    const sortedRatings = [...allRatings].sort((a, b) => a - b);
    const index = sortedRatings.findIndex(r => r >= rating);

    if (index === -1) return 100;
    return Math.round((index / sortedRatings.length) * 100);
}

/**
 * Get rating recommendation
 * 
 * AI/ML Concept: Recommendation system
 * - Suggests actions based on rating
 * - Used in chess engines for move selection
 * - Similar to recommendation engines in ML
 */
function getRatingRecommendation(rating, gamesPlayed) {
    if (gamesPlayed < 5) {
        return 'Keep playing to get a more accurate rating!';
    }

    if (rating < 1000) {
        return 'Focus on learning basic tactics and openings.';
    }

    if (rating < 1400) {
        return 'Practice endgames and improve your calculation skills.';
    }

    if (rating < 1800) {
        return 'Study advanced tactics and chess theory.';
    }

    if (rating < 2200) {
        return 'Work on strategic understanding and positional play.';
    }

    return 'You are a strong player! Consider playing faster time controls.';
}

if (typeof module !== 'undefined') {
    module.exports = {
        calculateExpectedScore,
        calculateNewRating,
        getRatingChange,
        getRatingClass,
        getRatingLevel,
        calculateRatingStats,
        formatRating,
        getRatingColor,
        getRatingDifferenceColor,
        createRatingBar,
        getRatingChangeIndicator,
        calculateRatingVolatility,
        getRatingStability,
        calculateRatingPercentile,
        getRatingRecommendation
    };
}