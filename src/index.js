const Settlement = require('./models/Settlement');
const Expense = require('./models/Expense');
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

// --- Get Flat Dashboard Route ---
app.get('/api/flats/dashboard', authMiddleware, async (req, res) => {
  try {
    // 1. Find a flat where the logged-in user's ID is inside the members array
    const flat = await Flat.findOne({ members: req.user.id })
      .populate('admin', 'name email')
      .populate('members', 'name email');

    if (!flat) {
      return res.status(404).json({ error: 'You do not belong to any flat yet!' });
    }

    res.status(200).json({
      message: 'Flat dashboard fetched successfully!',
      flat
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Add Expense Route ---
app.post('/api/expenses/create', authMiddleware, async (req, res) => {
  try {
    const { description, amount, splitBetween } = req.body;

    // 1. Find the flat that the logged-in user belongs to
    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You must belong to a flat to add an expense!' });
    }

    // 2. Create the new expense entry using our rulebook
    const newExpense = new Expense({
      description,
      amount,
      paidBy: req.user.id,     // The logged-in user paid the money
      flat: flat._id,          // Links it to their specific flat
      splitBetween: splitBetween || flat.members // If no list is provided, split it among all roommates by default!
    });

    // 3. Save it to MongoDB
    await newExpense.save();

    res.status(201).json({
      message: 'Expense added successfully!',
      expense: newExpense
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Get All Flat Expenses Route ---
app.get('/api/expenses/flat', authMiddleware, async (req, res) => {
  try {
    // 1. Find the flat that the logged-in user belongs to
    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You do not belong to any flat yet!' });
    }

    // 2. Find all expenses belonging to this specific flat's ID
    const expenses = await Expense.find({ flat: flat._id })
      .populate('paidBy', 'name email')
      .sort({ createdAt: -1 }); // Sorts them from newest to oldest!

    res.status(200).json({
      message: 'Expenses fetched successfully!',
      expenses
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Calculate Flat Balances Route (Updated with Settlements) ---
app.get('/api/expenses/balances', authMiddleware, async (req, res) => {
  try {
    const flat = await Flat.findOne({ members: req.user.id }).populate('members', 'name email');
    if (!flat) {
      return res.status(404).json({ error: 'You do not belong to any flat yet!' });
    }

    const expenses = await Expense.find({ flat: flat._id });
    const settlements = await Settlement.find({ flat: flat._id });

    const balances = {};
    flat.members.forEach(member => {
      balances[member._id.toString()] = {
        name: member.name,
        email: member.email,
        paid: 0,
        owed: 0,
        settlementAdjustment: 0,
        netBalance: 0
      };
    });

    // 1. Process Expenses
    expenses.forEach(expense => {
      const payerId = expense.paidBy.toString();
      const amount = expense.amount;
      const splitList = expense.splitBetween;

      if (balances[payerId]) {
        balances[payerId].paid += amount;
      }

      const splitAmount = amount / splitList.length;
      splitList.forEach(userId => {
        const idStr = userId.toString();
        if (balances[idStr]) {
          balances[idStr].owed += splitAmount;
        }
      });
    });

    // 2. Process Settlements (Cash paid back between roommates)
    settlements.forEach(settlement => {
      const payerId = settlement.paidBy.toString();
      const receiverId = settlement.paidTo.toString();
      const amount = settlement.amount;

      if (balances[payerId]) {
        balances[payerId].settlementAdjustment += amount;
      }
      if (balances[receiverId]) {
        balances[receiverId].settlementAdjustment -= amount;
      }
    });

    // 3. Final Net Balance Calculation
    Object.keys(balances).forEach(userId => {
      const user = balances[userId];
      user.netBalance = Number((user.paid - user.owed + user.settlementAdjustment).toFixed(2));
    });

    res.status(200).json({
      message: 'Flat balances calculated successfully!',
      balances: Object.values(balances)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Create Settlement (Settle Up) Route ---
app.post('/api/settlements/create', authMiddleware, async (req, res) => {
  try {
    const { paidTo, amount } = req.body;

    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You must belong to a flat to settle up!' });
    }

    const newSettlement = new Settlement({
      paidBy: req.user.id,
      paidTo,
      flat: flat._id,
      amount
    });

    await newSettlement.save();

    res.status(201).json({
      message: 'Payment recorded successfully!',
      settlement: newSettlement
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Create Settlement (Settle Up) Route ---
app.post('/api/settlements/create', authMiddleware, async (req, res) => {
  try {
    const { paidTo, amount } = req.body;

    // 1. Find the flat that the logged-in user belongs to
    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You must belong to a flat to settle up!' });
    }

    // 2. Create the settlement entry
    const newSettlement = new Settlement({
      paidBy: req.user.id, // The logged-in user is sending the money
      paidTo,              // The user receiving the money
      flat: flat._id,      // Links it to their flat
      amount               // How much was paid
    });

    // 3. Save to MongoDB
    await newSettlement.save();

    res.status(201).json({
      message: 'Payment recorded successfully!',
      settlement: newSettlement
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running smoothly on port ${PORT}`);
});