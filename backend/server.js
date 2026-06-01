const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize database tables
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS store_items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        price REAL NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS factory_items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        unit TEXT NOT NULL,
        quantity REAL DEFAULT 0,
        min_quantity REAL DEFAULT 0,
        price REAL DEFAULT 0
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_sales (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        store_item_id INTEGER,
        quantity INTEGER DEFAULT 0,
        total REAL DEFAULT 0
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS factory_usage (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        factory_item_id INTEGER,
        quantity_used REAL DEFAULT 0,
        notes TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        date TEXT NOT NULL,
        description TEXT,
        amount REAL DEFAULT 0
      )
    `);

    console.log('✅ All database tables ready');
  } catch (err) {
    console.error('Database init error:', err);
  } finally {
    client.release();
  }
}

initDatabase();

// ==================== STORE ITEMS API ====================
app.get('/api/store-items', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM store_items ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/store-items', async (req, res) => {
  const { name, price } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO store_items (name, price) VALUES ($1, $2) RETURNING id',
      [name, price]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/store-items/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM store_items WHERE id = $1', [req.params.id]);
    res.json({ message: 'تم حذف المنتج' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== FACTORY ITEMS API ====================
app.get('/api/factory-items', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM factory_items ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/factory-items', async (req, res) => {
  const { name, unit, quantity, min_quantity, price } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO factory_items (name, unit, quantity, min_quantity, price) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [name, unit, quantity || 0, min_quantity || 0, price || 0]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/factory-items/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM factory_items WHERE id = $1', [req.params.id]);
    res.json({ message: 'تم حذف المادة' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/factory-items/:id/add-stock', async (req, res) => {
  const { quantity } = req.body;
  try {
    await pool.query(
      'UPDATE factory_items SET quantity = quantity + $1 WHERE id = $2',
      [quantity, req.params.id]
    );
    res.json({ message: 'تم إضافة المخزون' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/low-stock', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM factory_items WHERE quantity <= min_quantity ORDER BY quantity ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== DAILY ITEMS API ====================
app.get('/api/daily-items/:date', async (req, res) => {
  const date = req.params.date;
  try {
    const items = await pool.query('SELECT * FROM store_items ORDER BY name');
    const sales = await pool.query(
      'SELECT store_item_id, quantity, total FROM daily_sales WHERE date = $1',
      [date]
    );
    
    const salesMap = new Map();
    sales.rows.forEach(sale => {
      salesMap.set(sale.store_item_id, { quantity: sale.quantity, total: sale.total });
    });
    
    const result = items.rows.map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: salesMap.get(item.id)?.quantity || 0,
      total: salesMap.get(item.id)?.total || 0
    }));
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get sales for a specific date
app.get('/api/sales', async (req, res) => {
  const { date } = req.query;
  try {
    const result = await pool.query(`
      SELECT ds.*, si.name as item_name, si.price 
      FROM daily_sales ds
      JOIN store_items si ON ds.store_item_id = si.id
      WHERE ds.date = $1
      ORDER BY si.name
    `, [date]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add or update sale - FIXED
app.post('/api/sales', async (req, res) => {
  const { date, store_item_id, quantity } = req.body;
  console.log('Saving sale:', { date, store_item_id, quantity });
  
  try {
    // Get item price
    const item = await pool.query('SELECT price FROM store_items WHERE id = $1', [store_item_id]);
    if (item.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    const total = item.rows[0].price * quantity;
    
    // Check if sale exists for this date and item
    const existing = await pool.query(
      'SELECT id FROM daily_sales WHERE date = $1 AND store_item_id = $2',
      [date, store_item_id]
    );
    
    if (existing.rows.length > 0) {
      // Update existing
      await pool.query(
        'UPDATE daily_sales SET quantity = $1, total = $2 WHERE date = $3 AND store_item_id = $4',
        [quantity, total, date, store_item_id]
      );
    } else {
      // Insert new
      await pool.query(
        'INSERT INTO daily_sales (date, store_item_id, quantity, total) VALUES ($1, $2, $3, $4)',
        [date, store_item_id, quantity, total]
      );
    }
    
    res.json({ success: true, total });
  } catch (err) {
    console.error('Error saving sale:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== FACTORY USAGE API ====================
app.get('/api/daily-factory/:date', async (req, res) => {
  const date = req.params.date;
  try {
    const items = await pool.query('SELECT * FROM factory_items ORDER BY name');
    const usage = await pool.query(
      'SELECT factory_item_id, quantity_used, notes FROM factory_usage WHERE date = $1',
      [date]
    );
    
    const usageMap = new Map();
    usage.rows.forEach(u => {
      usageMap.set(u.factory_item_id, { quantity_used: u.quantity_used, notes: u.notes });
    });
    
    const result = items.rows.map(item => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      current_quantity: item.quantity,
      quantity_used: usageMap.get(item.id)?.quantity_used || 0,
      notes: usageMap.get(item.id)?.notes || ''
    }));
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/factory-usage', async (req, res) => {
  const { date, factory_item_id, quantity_used, notes } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const item = await client.query('SELECT quantity FROM factory_items WHERE id = $1', [factory_item_id]);
    if (item.rows.length === 0) {
      throw new Error('Item not found');
    }
    
    const currentQuantity = item.rows[0].quantity;
    if (currentQuantity < quantity_used) {
      throw new Error('الكمية غير متوفرة في المخزن');
    }
    
    const existing = await client.query(
      'SELECT quantity_used FROM factory_usage WHERE date = $1 AND factory_item_id = $2',
      [date, factory_item_id]
    );
    
    const oldQuantity = existing.rows.length > 0 ? existing.rows[0].quantity_used : 0;
    const quantityDiff = quantity_used - oldQuantity;
    
    await client.query(
      'UPDATE factory_items SET quantity = quantity - $1 WHERE id = $2',
      [quantityDiff, factory_item_id]
    );
    
    if (existing.rows.length > 0) {
      await client.query(
        'UPDATE factory_usage SET quantity_used = $1, notes = $2 WHERE date = $3 AND factory_item_id = $4',
        [quantity_used, notes, date, factory_item_id]
      );
    } else {
      await client.query(
        'INSERT INTO factory_usage (date, factory_item_id, quantity_used, notes) VALUES ($1, $2, $3, $4)',
        [date, factory_item_id, quantity_used, notes]
      );
    }
    
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ==================== EXPENSES API ====================
app.get('/api/expenses', async (req, res) => {
  const { date } = req.query;
  try {
    const result = await pool.query(
      'SELECT * FROM expenses WHERE date = $1 ORDER BY id DESC',
      [date]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expenses', async (req, res) => {
  const { date, description, amount } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO expenses (date, description, amount) VALUES ($1, $2, $3) RETURNING id',
      [date, description, amount]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM expenses WHERE id = $1', [req.params.id]);
    res.json({ message: 'تم حذف المصروف' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SUMMARY API ====================
app.get('/api/summary/:date', async (req, res) => {
  const date = req.params.date;
  try {
    const sales = await pool.query('SELECT COALESCE(SUM(total), 0) as total_sales FROM daily_sales WHERE date = $1', [date]);
    const expenses = await pool.query('SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses WHERE date = $1', [date]);
    
    res.json({
      total_sales: parseFloat(sales.rows[0]?.total_sales || 0),
      total_expenses: parseFloat(expenses.rows[0]?.total_expenses || 0),
      factory_cost: 0,
      net: parseFloat(sales.rows[0]?.total_sales || 0) - parseFloat(expenses.rows[0]?.total_expenses || 0)
    });
  } catch (err) {
    res.json({ total_sales: 0, total_expenses: 0, factory_cost: 0, net: 0 });
  }
});

// ==================== MONTHLY REPORT API - Shows every day in month ====================
app.get('/api/monthly-report/:year/:month', async (req, res) => {
  const { year, month } = req.params;
  const datePrefix = `${year}-${month.padStart(2, '0')}`;
  
  try {
    // Get all days in the month
    const daysInMonth = new Date(parseInt(year), parseInt(month), 0).getDate();
    const allDates = [];
    for (let i = 1; i <= daysInMonth; i++) {
      allDates.push(`${datePrefix}-${String(i).padStart(2, '0')}`);
    }
    
    // Get sales for each day
    const salesData = await pool.query(`
      SELECT date, COALESCE(SUM(total), 0) as daily_sales
      FROM daily_sales 
      WHERE date LIKE $1
      GROUP BY date
    `, [`${datePrefix}%`]);
    
    // Get expenses for each day
    const expensesData = await pool.query(`
      SELECT date, COALESCE(SUM(amount), 0) as daily_expenses
      FROM expenses 
      WHERE date LIKE $1
      GROUP BY date
    `, [`${datePrefix}%`]);
    
    // Create maps
    const salesMap = new Map();
    salesData.rows.forEach(s => salesMap.set(s.date, parseFloat(s.daily_sales)));
    
    const expensesMap = new Map();
    expensesData.rows.forEach(e => expensesMap.set(e.date, parseFloat(e.daily_expenses)));
    
    // Build daily data for EVERY day in the month
    const dailyData = allDates.map(date => {
      const sales = salesMap.get(date) || 0;
      const expenses = expensesMap.get(date) || 0;
      const net = sales - expenses;
      return {
        date: date,
        sales: sales,
        expenses: expenses,
        factory_cost: 0,
        net: net
      };
    });
    
    // Calculate totals
    const totalSales = dailyData.reduce((sum, d) => sum + d.sales, 0);
    const totalExpenses = dailyData.reduce((sum, d) => sum + d.expenses, 0);
    
    // Get top selling items
    const topItems = await pool.query(`
      SELECT si.name, COALESCE(SUM(ds.quantity), 0) as total_quantity, COALESCE(SUM(ds.total), 0) as total_revenue
      FROM daily_sales ds
      JOIN store_items si ON ds.store_item_id = si.id
      WHERE ds.date LIKE $1
      GROUP BY ds.store_item_id, si.name
      ORDER BY total_revenue DESC
      LIMIT 5
    `, [`${datePrefix}%`]);
    
    res.json({
      daily_data: dailyData,
      summary: {
        total_sales: totalSales,
        total_expenses: totalExpenses,
        total_factory_cost: 0,
        net_profit: totalSales - totalExpenses
      },
      top_selling_items: topItems.rows,
      top_used_factory_items: []
    });
  } catch (err) {
    console.error('Monthly report error:', err);
    res.json({
      daily_data: [],
      summary: { total_sales: 0, total_expenses: 0, total_factory_cost: 0, net_profit: 0 },
      top_selling_items: [],
      top_used_factory_items: []
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ Server running on port ${PORT}`);
});