/* ==========================================================
   MARVEL TOYS STORE - BACKEND (single file)
   Node.js + Express + MySQL

   HOW TO RUN:
   1) npm init -y
   2) npm install express mysql2 bcryptjs jsonwebtoken cors
   3) Edit the CONFIG object below with your MySQL details
   4) node server.js
   ========================================================== */

require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// ---------------- CONFIG (reads from .env file, falls back to defaults) ----------------
const CONFIG = {
    DB_HOST: process.env.DB_HOST || 'localhost',
    DB_USER: process.env.DB_USER || 'root',
    DB_PASSWORD: process.env.DB_PASSWORD || 'your_mysql_password',   // <-- change in .env
    DB_NAME: process.env.DB_NAME || 'marvel_toys_store',
    DB_PORT: process.env.DB_PORT || 3306,
    JWT_SECRET: process.env.JWT_SECRET || 'marvel_super_secret_key_change_this',
    PORT: process.env.PORT || 5000
};

// ---------------- DATABASE CONNECTION ----------------
const pool = mysql.createPool({
    host: CONFIG.DB_HOST,
    user: CONFIG.DB_USER,
    password: CONFIG.DB_PASSWORD,
    database: CONFIG.DB_NAME,
    port: CONFIG.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ---------------- APP SETUP ----------------
const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend (index.html) from the same server
// Place your frontend/index.html file inside a folder named "public" next to server.js
const path = require('path');
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- AUTH MIDDLEWARE ----------------
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'No token provided. Please login.' });
    }

    jwt.verify(token, CONFIG.JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token.' });
        }
        req.user = decoded;
        next();
    });
}

/* ==========================================================
   AUTH ROUTES
   ========================================================== */

// REGISTER
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Name, email and password are required.' });
        }

        const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'Email already registered.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword]
        );

        const token = jwt.sign({ id: result.insertId, email }, CONFIG.JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            message: 'Registration successful!',
            token,
            user: { id: result.insertId, name, email }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// LOGIN
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required.' });
        }

        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }

        const token = jwt.sign({ id: user.id, email: user.email }, CONFIG.JWT_SECRET, { expiresIn: '7d' });

        res.json({
            message: 'Login successful!',
            token,
            user: { id: user.id, name: user.name, email: user.email }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

/* ==========================================================
   PRODUCT ROUTES
   ========================================================== */

app.get('/api/products', async (req, res) => {
    try {
        const [products] = await pool.query('SELECT * FROM products ORDER BY id DESC');
        res.json(products);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching products.' });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Product not found.' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching product.' });
    }
});

/* ==========================================================
   CART ROUTES (login required)
   ========================================================== */

app.get('/api/cart', authMiddleware, async (req, res) => {
    try {
        const [items] = await pool.query(
            `SELECT cart.id, cart.quantity, products.id AS product_id, products.name,
                    products.price, products.image_url
             FROM cart
             JOIN products ON cart.product_id = products.id
             WHERE cart.user_id = ?`,
            [req.user.id]
        );
        res.json(items);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching cart.' });
    }
});

app.post('/api/cart', authMiddleware, async (req, res) => {
    try {
        const { product_id, quantity } = req.body;
        const qty = quantity || 1;

        const [existing] = await pool.query(
            'SELECT * FROM cart WHERE user_id = ? AND product_id = ?',
            [req.user.id, product_id]
        );

        if (existing.length > 0) {
            await pool.query('UPDATE cart SET quantity = quantity + ? WHERE id = ?', [qty, existing[0].id]);
        } else {
            await pool.query(
                'INSERT INTO cart (user_id, product_id, quantity) VALUES (?, ?, ?)',
                [req.user.id, product_id, qty]
            );
        }

        res.status(201).json({ message: 'Added to cart!' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error adding to cart.' });
    }
});

app.delete('/api/cart/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM cart WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.json({ message: 'Removed from cart.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error removing from cart.' });
    }
});

/* ==========================================================
   ORDER / CHECKOUT ROUTES (login required)
   ========================================================== */

app.post('/api/orders/checkout', authMiddleware, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [cartItems] = await connection.query(
            `SELECT cart.product_id, cart.quantity, products.price
             FROM cart JOIN products ON cart.product_id = products.id
             WHERE cart.user_id = ?`,
            [req.user.id]
        );

        if (cartItems.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ message: 'Your cart is empty.' });
        }

        const totalAmount = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

        const [orderResult] = await connection.query(
            'INSERT INTO orders (user_id, total_amount, status) VALUES (?, ?, ?)',
            [req.user.id, totalAmount, 'placed']
        );
        const orderId = orderResult.insertId;

        for (const item of cartItems) {
            await connection.query(
                'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)',
                [orderId, item.product_id, item.quantity, item.price]
            );
        }

        await connection.query('DELETE FROM cart WHERE user_id = ?', [req.user.id]);
        await connection.commit();
        connection.release();

        res.status(201).json({
            message: 'Order placed successfully!',
            order_id: orderId,
            total_amount: totalAmount
        });
    } catch (err) {
        await connection.rollback();
        connection.release();
        console.error(err);
        res.status(500).json({ message: 'Server error during checkout.' });
    }
});

app.get('/api/orders', authMiddleware, async (req, res) => {
    try {
        const [orders] = await pool.query(
            'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
            [req.user.id]
        );

        for (const order of orders) {
            const [items] = await pool.query(
                `SELECT order_items.quantity, order_items.price, products.name, products.image_url
                 FROM order_items JOIN products ON order_items.product_id = products.id
                 WHERE order_items.order_id = ?`,
                [order.id]
            );
            order.items = items;
        }

        res.json(orders);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error fetching orders.' });
    }
});

/* ==========================================================
   AUTO-CREATE DATABASE TABLES ON STARTUP
   (so you don't need to run schema.sql manually)
   ========================================================== */

async function initDatabase() {
    const rootConn = await mysql.createConnection({
        host: CONFIG.DB_HOST,
        user: CONFIG.DB_USER,
        password: CONFIG.DB_PASSWORD,
        port: CONFIG.DB_PORT
    });

    await rootConn.query(`CREATE DATABASE IF NOT EXISTS ${CONFIG.DB_NAME}`);
    await rootConn.end();

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(150) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(150) NOT NULL,
            description TEXT,
            price DECIMAL(10,2) NOT NULL,
            image_url VARCHAR(500),
            stock INT DEFAULT 100,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS cart (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            product_id INT NOT NULL,
            quantity INT NOT NULL DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            total_amount DECIMAL(10,2) NOT NULL,
            status VARCHAR(50) DEFAULT 'placed',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            product_id INT NOT NULL,
            quantity INT NOT NULL,
            price DECIMAL(10,2) NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    `);

    // Insert sample Marvel toys only if table is empty
    const [rows] = await pool.query('SELECT COUNT(*) AS count FROM products');
    if (rows[0].count === 0) {
        await pool.query(`
            INSERT INTO products (name, description, price, image_url, stock) VALUES
            ('Iron Man Mark 85 Action Figure', 'Fully articulated 6-inch Iron Man action figure with light-up chest arc.', 1499.00, 'https://placehold.co/300x300?text=Iron+Man', 50),
            ('Spider-Man Web Shooter Toy', 'Wearable web shooter with foam web launcher, inspired by Spider-Man.', 899.00, 'https://placehold.co/300x300?text=Spider-Man', 80),
            ('Thor Mjolnir Hammer Replica', 'Life-size foam replica of Thor Mjolnir hammer with sound effects.', 1999.00, 'https://placehold.co/300x300?text=Mjolnir', 30),
            ('Hulk Smash Fist Gloves', 'Inflatable Hulk fists for kids role play with smash sound.', 799.00, 'https://placehold.co/300x300?text=Hulk+Fists', 60),
            ('Captain America Shield', 'Vibranium-style shield replica, lightweight and durable for play.', 1299.00, 'https://placehold.co/300x300?text=Cap+Shield', 45),
            ('Black Panther Action Figure', '7-inch articulated Black Panther figure with vibranium suit detail.', 1599.00, 'https://placehold.co/300x300?text=Black+Panther', 40),
            ('Avengers Mini Figures Set (6 pcs)', 'Set of 6 collectible mini Avengers figures.', 2499.00, 'https://placehold.co/300x300?text=Avengers+Set', 25),
            ('Venom Symbiote Figure', 'Detailed Venom action figure with movable joints.', 1399.00, 'https://placehold.co/300x300?text=Venom', 35)
        `);
        console.log('Sample Marvel toy products inserted.');
    }

    console.log('Database ready.');
}

/* ==========================================================
   START SERVER
   ========================================================== */

initDatabase()
    .then(() => {
        app.listen(CONFIG.PORT, () => {
            console.log(`Marvel Toys Store backend running on http://localhost:${CONFIG.PORT}`);
        });
    })
    .catch(err => {
        console.error('Failed to initialize database:', err);
    });