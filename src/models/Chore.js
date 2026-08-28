const mongoose = require('mongoose');

const choreSchema = new mongoose.Schema({
  title: { type: String, required: true },
  flat: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['Pending', 'Completed'], default: 'Pending' },
  dueDate: { type: String, default: 'This Week' }
}, { timestamps: true });

module.exports = mongoose.model('Chore', choreSchema);