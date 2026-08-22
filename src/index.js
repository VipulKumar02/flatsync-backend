const Flat = require('./models/Flat');
const authMiddleware = require('./middleware/authMiddleware');
const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const User = require('./models/User');

const app = express();

app.use(cors());
app.use(express.json());

// --- Database Connection ---
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected Successfully!');
  } catch (err) {
    console.error('MongoDB Connection Error:', err.message);
    process.exit(1);
  }
};

connectDB();

app.get('/', (req, res) => {
  res.send('FlatSync Backend is up and running!');
});

// --- Register Route with Password Hashing ---
app.post('/api/users/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email already exists!' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
    });
    
    await newUser.save();

    res.status(201).json({
      message: 'User registered successfully!',
      user: { id: newUser._id, name: newUser.name, email: newUser.email }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Login Route with JWT ---
app.post('/api/users/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password!' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid email or password!' });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(200).json({
      message: 'Logged in successfully!',
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Protected Route Example (Uses Auth Middleware) ---
app.get('/api/users/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    res.status(200).json({
      message: 'You have accessed a protected route successfully!',
      user,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Create Flat Route ---
app.post('/api/flats/create', authMiddleware, async (req, res) => {
  try {
    const { name, address } = req.body;

    // Generate a short unique invite code (e.g., "A3F9B2")
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const newFlat = new Flat({
      name,
      address,
      inviteCode,
      admin: req.user.id,     // Comes from our authMiddleware bouncer!
      members: [req.user.id]  // The creator is automatically the first member
    });

    await newFlat.save();

    res.status(201).json({
      message: 'Flat created successfully!',
      flat: newFlat
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Join Flat Route ---
app.post('/api/flats/join', authMiddleware, async (req, res) => {
  try {
    const { inviteCode } = req.body;

    // 1. Find the flat matching the invite code
    const flat = await Flat.findOne({ inviteCode });
    if (!flat) {
      return res.status(404).json({ error: 'Invalid invite code. Flat not found!' });
    }

    // 2. Check if the user is already a member of this flat
    const isAlreadyMember = flat.members.includes(req.user.id);
    if (isAlreadyMember) {
      return res.status(400).json({ error: 'You are already a member of this flat!' });
    }

    // 3. Add the user's ID to the flat's members array
    flat.members.push(req.user.id);
    await flat.save();

    res.status(200).json({
      message: 'Joined flat successfully!',
      flat
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running smoothly on port ${PORT}`);
});