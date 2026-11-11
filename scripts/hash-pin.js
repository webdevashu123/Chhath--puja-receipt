import bcrypt from 'bcryptjs';

const pin = process.argv[2] || '2026';
const saltRounds = 10;

const hash = bcrypt.hashSync(pin, saltRounds);
console.log(`PIN: ${pin}`);
console.log(`Bcrypt Hash: ${hash}`);
