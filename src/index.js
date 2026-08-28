const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const dns = require('node:dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);

const User = require('./models/User');
const Flat = require('./models/Flat');
const Expense = require('./models/Expense');
const Settlement = require('./models/Settlement');
const Chore = require('./models/Chore');
const Grocery = require('./models/Grocery');
const Notice = require('./models/Notice');
const authMiddleware = require('./middleware/authMiddleware');

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

// --- Protected Profile Route ---
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
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const newFlat = new Flat({
      name,
      address,
      inviteCode,
      admin: req.user.id,
      members: [req.user.id]
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

    const flat = await Flat.findOne({ inviteCode });
    if (!flat) {
      return res.status(404).json({ error: 'Invalid invite code. Flat not found!' });
    }

    const isAlreadyMember = flat.members.includes(req.user.id);
    if (isAlreadyMember) {
      return res.status(400).json({ error: 'You are already a member of this flat!' });
    }

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

    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You must belong to a flat to add an expense!' });
    }

    const newExpense = new Expense({
      description,
      amount,
      paidBy: req.user.id,
      flat: flat._id,
      splitBetween: splitBetween || flat.members
    });

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
    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You do not belong to any flat yet!' });
    }

    const expenses = await Expense.find({ flat: flat._id })
      .populate('paidBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      message: 'Expenses fetched successfully!',
      expenses
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Calculate Flat Balances Route ---
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

// --- Create Chore Route with Fair Round-Robin Rotation ---
app.post('/api/chores/create', authMiddleware, async (req, res) => {
  try {
    const { title, dueDate } = req.body;
    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You must belong to a flat to add a chore!' });
    }

    if (!flat.members || flat.members.length === 0) {
      return res.status(400).json({ error: 'No members found in this flat!' });
    }

    const existingChores = await Chore.find({ flat: flat._id, status: 'Pending' });

    const workloadCounts = {};
    flat.members.forEach(memberId => {
      workloadCounts[memberId.toString()] = 0;
    });

    existingChores.forEach(chore => {
      if (chore.assignedTo) {
        const assignedId = chore.assignedTo.toString();
        if (workloadCounts[assignedId] !== undefined) {
          workloadCounts[assignedId]++;
        }
      }
    });

    let nextAssigneeId = flat.members[0];
    let minWorkload = Infinity;

    flat.members.forEach(memberId => {
      const idStr = memberId.toString();
      if (workloadCounts[idStr] < minWorkload) {
        minWorkload = workloadCounts[idStr];
        nextAssigneeId = memberId;
      }
    });

    const newChore = new Chore({
      title,
      flat: flat._id,
      assignedTo: nextAssigneeId,
      dueDate: dueDate || 'This Week'
    });

    await newChore.save();
    const populatedChore = await Chore.findById(newChore._id).populate('assignedTo', 'name email');

    res.status(201).json({ message: 'Chore created and rotated successfully!', chore: populatedChore });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Get Flat Chores Route ---
app.get('/api/chores/flat', authMiddleware, async (req, res) => {
  try {
    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You do not belong to any flat yet!' });
    }

    const chores = await Chore.find({ flat: flat._id }).populate('assignedTo', 'name email').sort({ createdAt: -1 });
    res.status(200).json({ message: 'Chores fetched successfully!', chores });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Toggle Chore Status Route ---
app.patch('/api/chores/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const chore = await Chore.findById(req.params.id);
    if (!chore) return res.status(404).json({ error: 'Chore not found!' });

    chore.status = chore.status === 'Completed' ? 'Pending' : 'Completed';
    await chore.save();

    const updatedChore = await Chore.findById(chore._id).populate('assignedTo', 'name email');
    res.status(200).json({ message: 'Chore status updated!', chore: updatedChore });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Create Grocery Item Route ---
app.post('/api/groceries/create', authMiddleware, async (req, res) => {
  try {
    const { title } = req.body;
    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You must belong to a flat to add items!' });
    }

    const newItem = new Grocery({
      title,
      flat: flat._id,
      addedBy: req.user.id,
      checked: false
    });

    await newItem.save();
    const populatedItem = await Grocery.findById(newItem._id).populate('addedBy', 'name email');

    res.status(201).json({ message: 'Grocery item added!', item: populatedItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Get Flat Groceries Route ---
app.get('/api/groceries/flat', authMiddleware, async (req, res) => {
  try {
    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You do not belong to any flat yet!' });
    }

    const groceries = await Grocery.find({ flat: flat._id }).populate('addedBy', 'name email').sort({ createdAt: -1 });
    res.status(200).json({ message: 'Groceries fetched successfully!', groceries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Toggle Grocery Check Status Route ---
app.patch('/api/groceries/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const item = await Grocery.findById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found!' });

    item.checked = !item.checked;
    await item.save();

    const updatedItem = await Grocery.findById(item._id).populate('addedBy', 'name email');
    res.status(200).json({ message: 'Grocery status updated!', item: updatedItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- Create Notice Route ---
app.post('/api/notices/create', authMiddleware, async (req, res) => {
  try {
    const { title, content } = req.body;
    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You must belong to a flat to post a notice!' });
    }

    const newNotice = new Notice({
      title,
      content,
      flat: flat._id,
      postedBy: req.user.id
    });

    await newNotice.save();
    const populatedNotice = await Notice.findById(newNotice._id).populate('postedBy', 'name email');

    res.status(201).json({ message: 'Notice posted successfully!', notice: populatedNotice });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Get Flat Notices Route ---
app.get('/api/notices/flat', authMiddleware, async (req, res) => {
  try {
    const flat = await Flat.findOne({ members: req.user.id });
    if (!flat) {
      return res.status(404).json({ error: 'You do not belong to any flat yet!' });
    }

    const notices = await Notice.find({ flat: flat._id }).populate('postedBy', 'name email').sort({ createdAt: -1 });
    res.status(200).json({ message: 'Notices fetched successfully!', notices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running smoothly on port ${PORT}`);
});