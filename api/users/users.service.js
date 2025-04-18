const User = require('./users.model');

const registerUser = async (email, password, role = 'user') => {
  return await User.create({ email, password, role });
};

const findUserByEmail = async (email) => {
  return await User.findOne({ where: { email } });
};

module.exports = {
  registerUser,
  findUserByEmail
};
