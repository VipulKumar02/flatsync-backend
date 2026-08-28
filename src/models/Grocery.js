const mongoose = require('mongoose');

const grocerySchema = new mongoose.Schema({
  title: { type: String, required: true },
  flat: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', required: true },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  checked: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Grocery', grocerySchema);