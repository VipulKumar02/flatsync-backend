const mongoose = require('mongoose');

const settlementSchema = new mongoose.Schema({
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  paidTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  flat: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', required: true },
  amount: { type: Number, required: true }
}, { timestamps: true });

module.exports = mongoose.model('Settlement', settlementSchema);