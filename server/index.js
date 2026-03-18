const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key';
const BASE_URL = process.env.BASE_URL || (process.env.NODE_ENV === 'production' ? `http://localhost:${PORT}` : 'http://localhost:5173');

const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Email Transporter
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // Use SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendWelcomeEmail = async (email) => {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Welcome to Foto-Collab - Registration Successful',
    html: `<h3>Welcome to Foto-Collab!</h3>
           <p>Your registration was successful. You can now log in and start collaborating on your photo projects.</p>
           <p>Best regards,<br>The Foto-Collab Team</p>`
  };
  await transporter.sendMail(mailOptions);
};

const sendPasswordResetEmail = async (email, token) => {
  const url = `${BASE_URL}/reset-password?token=${token}`;
  
  console.log('--- PASSWORD RESET LINK (Dev Console) ---');
  console.log(`Email: ${email}`);
  console.log(`URL: ${url}`);
  console.log('-----------------------------------------');

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Password Reset Request - Foto-Collab',
    html: `<h3>Password Reset Request</h3>
           <p>You requested a password reset. Please click the link below to set a new password:</p>
           <a href="${url}">${url}</a>
           <p>If you did not request this, please ignore this email.</p>`
  };
  await transporter.sendMail(mailOptions);
};

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());

// Serve static files from the React app
app.use(express.static(path.join(__dirname, '../client/dist')));
// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

const membershipTiers = {
  free: { 
    name: 'Free', 
    price: '$0/mo', 
    storageLimitGB: 10,
    features: ['Basic Collaboration', 'Email Support', 'Standard Quality']
  },
  casual: { 
    name: 'Casual', 
    price: '$10/mo', 
    storageLimitGB: 50,
    features: ['Advanced Tools', 'Priority Support', 'HD Quality']
  },
  pro: { 
    name: 'Pro', 
    price: '$25/mo', 
    storageLimitGB: 1000,
    features: ['Unlimited Everything', '24/7 Support', 'Raw Export']
  },
};

// --- Auth Middleware ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- Auth Endpoints ---
app.post('/api/auth/register', async (req, res) => {
  const { email, password, phone } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const sql = `INSERT INTO users (email, password, phone, storageUsed, isVerified) VALUES (?, ?, ?, ?, ?)`;
  
  db.run(sql, [email, hashedPassword, phone, 0, 1], function(err) {
    if (err) return res.status(400).json({ message: 'User already exists' });
    const userId = this.lastID;
    const token = jwt.sign({ id: userId, email }, JWT_SECRET, { expiresIn: '1h' });
    
    // Send welcome email in background
    sendWelcomeEmail(email).catch(err => console.error('Welcome email failed:', err));

    res.status(201).json({ token, user: { id: userId, email, membership: 'Free', storageUsed: 0 }, message: 'Registration successful. You can now log in.' });
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) return res.status(400).json({ message: 'Invalid credentials' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, user: { id: user.id, email: user.email, membership: user.membership, storageUsed: user.storageUsed } });
  });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  db.get('SELECT id, email, membership, storageUsed FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err || !user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user) => {
    if (err || !user) return res.status(404).json({ message: 'User not found' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 3600000; // 1 hour

    db.run('UPDATE users SET resetToken = ?, resetTokenExpiry = ? WHERE id = ?', [token, expiry, user.id], async (err) => {
      if (err) return res.status(500).json({ message: 'Failed to generate reset token' });

      try {
        console.log(`Attempting to send reset email to: ${email} using ${process.env.EMAIL_USER}`);
        await sendPasswordResetEmail(email, token);
        console.log('Reset email sent successfully');
        res.json({ message: 'Password reset link sent to your email.' });
      } catch (emailErr) {
        console.error('DETAILED EMAIL ERROR:', emailErr);
        res.status(500).json({ message: `Failed to send reset email: ${emailErr.message}` });
      }
    });
  });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  db.get('SELECT * FROM users WHERE resetToken = ? AND resetTokenExpiry > ?', [token, Date.now()], async (err, user) => {
    if (err || !user) return res.status(400).json({ message: 'Invalid or expired reset token' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    db.run('UPDATE users SET password = ?, resetToken = NULL, resetTokenExpiry = NULL WHERE id = ?', [hashedPassword, user.id], (err) => {
      if (err) return res.status(500).json({ message: 'Failed to update password' });
      res.json({ message: 'Password reset successful. You can now log in.' });
    });
  });
});

// --- Community Endpoints ---
app.get('/api/users', authenticateToken, (req, res) => {
  const query = req.query.search || '';
  db.all('SELECT id, email FROM users WHERE email LIKE ? AND id != ?', [`%${query}%`, req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch users' });
    res.json(rows);
  });
});

// --- Chat Endpoints ---
app.get('/api/channels', authenticateToken, (req, res) => {
  db.all(`
    SELECT c.* FROM channels c 
    LEFT JOIN channel_members cm ON c.id = cm.channelId 
    WHERE c.type = 'public' OR cm.userId = ? OR c.ownerId = ?
    GROUP BY c.id
  `, [req.user.id, req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch channels' });
    res.json(rows);
  });
});

app.post('/api/channels', authenticateToken, (req, res) => {
  const { name, type, pin } = req.body;
  db.run('INSERT INTO channels (name, type, pin, ownerId) VALUES (?, ?, ?, ?)', [name, type, pin, req.user.id], function(err) {
    if (err) return res.status(500).json({ message: 'Failed to create channel' });
    const channelId = this.lastID;
    db.run('INSERT INTO channel_members (channelId, userId) VALUES (?, ?)', [channelId, req.user.id], () => {
      res.status(201).json({ id: channelId, name, type, pin });
    });
  });
});

app.post('/api/channels/:id/join', authenticateToken, (req, res) => {
  const { pin } = req.body;
  const channelId = req.params.id;
  db.get('SELECT * FROM channels WHERE id = ?', [channelId], (err, channel) => {
    if (!channel) return res.status(404).json({ message: 'Channel not found' });
    if (channel.type === 'private' && channel.pin !== pin) return res.status(403).json({ message: 'Invalid PIN' });
    
    db.run('INSERT OR IGNORE INTO channel_members (channelId, userId) VALUES (?, ?)', [channelId, req.user.id], (err) => {
      if (err) return res.status(500).json({ message: 'Failed to join channel' });
      res.json({ message: 'Joined successfully' });
    });
  });
});

app.get('/api/channels/:id/messages', authenticateToken, (req, res) => {
  db.all(`
    SELECT m.*, u.email as userEmail FROM messages m 
    JOIN users u ON m.userId = u.id 
    WHERE m.channelId = ? 
    ORDER BY m.timestamp ASC
  `, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch messages' });
    res.json(rows);
  });
});

app.post('/api/channels/:id/messages', authenticateToken, (req, res) => {
  const { content } = req.body;
  db.run('INSERT INTO messages (channelId, userId, content) VALUES (?, ?, ?)', [req.params.id, req.user.id, content], function(err) {
    if (err) return res.status(500).json({ message: 'Failed to send message' });
    res.status(201).json({ id: this.lastID, channelId: req.params.id, userId: req.user.id, content });
  });
});

// --- Project & File Endpoints ---
app.get('/api/projects', authenticateToken, (req, res) => {
  db.all('SELECT * FROM projects WHERE userId = ? ORDER BY createdAt DESC', [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch projects' });
    res.json(rows);
  });
});

app.get('/api/projects/recent', authenticateToken, (req, res) => {
  db.all('SELECT * FROM projects WHERE userId = ? ORDER BY updatedAt DESC LIMIT 5', [req.user.id], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch recent projects' });
    res.json(rows);
  });
});

app.post('/api/projects', authenticateToken, (req, res) => {
  const { name } = req.body;
  db.run('INSERT INTO projects (userId, name, collaborators, photos) VALUES (?, ?, ?, ?)', [req.user.id, name, 1, 0], function(err) {
    if (err) return res.status(500).json({ message: 'Failed to create project' });
    res.status(201).json({ id: this.lastID, name, collaborators: 1, photos: 0 });
  });
});

app.get('/api/projects/:projectId/files', authenticateToken, (req, res) => {
  db.all('SELECT * FROM files WHERE projectId = ? ORDER BY orderIndex ASC', [req.params.projectId], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch files' });
    res.json(rows);
  });
});

app.post('/api/projects/:projectId/files', authenticateToken, upload.single('file'), (req, res) => {
  const { projectId } = req.params;
  const { name } = req.body;
  if (!req.file) return res.status(400).json({ message: 'File is required' });

  const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
  const url = `${baseUrl}/uploads/${req.file.filename}`;
  const sizeGB = req.file.size / (1024 * 1024 * 1024);
  const type = req.file.mimetype.startsWith('video/') ? 'video' : req.file.mimetype.startsWith('image/') ? 'image' : 'file';

  // Check storage limit
  db.get('SELECT storageUsed, membership FROM users WHERE id = ?', [req.user.id], (err, user) => {
    const limit = membershipTiers[user.membership.toLowerCase()].storageLimitGB;
    if (user.storageUsed + sizeGB > limit) return res.status(403).json({ message: 'Storage limit exceeded' });

    db.get('SELECT COUNT(*) as count FROM files WHERE projectId = ?', [projectId], (err, row) => {
      const orderIndex = row ? row.count : 0;
      db.run('INSERT INTO files (projectId, url, name, type, size, orderIndex) VALUES (?, ?, ?, ?, ?, ?)', [projectId, url, name || req.file.originalname, type, sizeGB, orderIndex], function(err) {
        db.run('UPDATE users SET storageUsed = storageUsed + ? WHERE id = ?', [sizeGB, req.user.id]);
        db.run('UPDATE projects SET photos = photos + 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [projectId]);
        res.status(201).json({ id: this.lastID, url, name: name || req.file.originalname, type, size: sizeGB, orderIndex });
      });
    });
  });
});

app.delete('/api/projects/:projectId', authenticateToken, (req, res) => {
  const { projectId } = req.params;
  
  // First, get all files to subtract storage
  db.all('SELECT size FROM files WHERE projectId = ?', [projectId], (err, files) => {
    const totalSize = files.reduce((acc, f) => acc + f.size, 0);
    
    db.run('DELETE FROM files WHERE projectId = ?', [projectId], () => {
      db.run('DELETE FROM projects WHERE id = ? AND userId = ?', [projectId, req.user.id], function(err) {
        if (this.changes === 0) return res.status(404).json({ message: 'Project not found' });
        
        db.run('UPDATE users SET storageUsed = storageUsed - ? WHERE id = ?', [totalSize, req.user.id]);
        res.json({ message: 'Project deleted successfully' });
      });
    });
  });
});

app.delete('/api/files/:fileId', authenticateToken, (req, res) => {
  const { fileId } = req.params;
  
  db.get('SELECT f.*, p.userId FROM files f JOIN projects p ON f.projectId = p.id WHERE f.id = ?', [fileId], (err, file) => {
    if (!file || file.userId !== req.user.id) return res.status(404).json({ message: 'File not found' });
    
    db.run('DELETE FROM files WHERE id = ?', [fileId], function(err) {
      db.run('UPDATE users SET storageUsed = storageUsed - ? WHERE id = ?', [file.size, req.user.id]);
      db.run('UPDATE projects SET photos = photos - 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [file.projectId]);
      res.json({ message: 'File deleted successfully' });
    });
  });
});

app.patch('/api/files/:fileId', authenticateToken, (req, res) => {
  const { fileId } = req.params;
  const { name } = req.body;
  
  db.get('SELECT f.*, p.userId FROM files f JOIN projects p ON f.projectId = p.id WHERE f.id = ?', [fileId], (err, file) => {
    if (!file || file.userId !== req.user.id) return res.status(404).json({ message: 'File not found' });
    
    db.run('UPDATE files SET name = ? WHERE id = ?', [name, fileId], function(err) {
      res.json({ message: 'File updated successfully' });
    });
  });
});

app.patch('/api/projects/:projectId/files/reorder', authenticateToken, (req, res) => {
  const { projectId } = req.params;
  const { fileIds } = req.body; // Array of IDs in new order
  
  const stmt = db.prepare('UPDATE files SET orderIndex = ? WHERE id = ? AND projectId = ?');
  fileIds.forEach((id, index) => {
    stmt.run(index, id, projectId);
  });
  stmt.finalize();
  
  res.json({ message: 'Order updated successfully' });
});

// --- Membership Endpoints ---
app.get('/api/config/memberships', (req, res) => res.json(membershipTiers));
app.post('/api/user/membership', authenticateToken, (req, res) => {
  const { membership } = req.body;
  db.run('UPDATE users SET membership = ? WHERE id = ?', [membership, req.user.id], () => res.json({ message: 'Updated' }));
});

// Catch-all
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../client/dist/index.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
