const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  // 1. Get the token from the header
  const authHeader = req.header('Authorization');

  // 2. Check if token exists
  if (!authHeader) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  // 3. The token format is usually "Bearer <token>"
  const token = authHeader.split(' ')[1];

  try {
    // 4. Verify the token using your secret
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified; // Save the user info for the next step
    next(); // Move to the next function
  } catch (err) {
    res.status(400).json({ error: 'Invalid Token' });
  }
};

module.exports = authMiddleware;
