// index.js
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

const app = express();
const port = 5000;
app.use(express.json());

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/Rexiler', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Define the schema and model for the collection
const transactionSchema = new mongoose.Schema({
  transactionId: String,
  productId: String,
  userId: String,
  amount: Number,
  date: Date,
  title: String,
  description: String,
  price: Number,
  category: String // Added category field
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// Middleware to parse JSON
app.use(express.json());

// Helper function to parse date and handle invalid formats
function parseDate(dateString) {
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? null : date; // Return null for invalid dates
}

// Route to initialize the database
app.get('/initialize', async (req, res) => {
  try {
    const response = await axios.get('https://s3.amazonaws.com/roxiler.com/product_transaction.json');
    const data = response.data;

    if (!Array.isArray(data)) {
      return res.status(400).json({ message: 'Invalid data format' });
    }

    await Transaction.deleteMany({});

    const transactions = data.map(item => ({
      transactionId: item.transaction_id,
      productId: item.product_id,
      userId: item.user_id,
      amount: item.amount,
      date: parseDate(item.date),
      title: item.title || '',
      description: item.description || '',
      price: item.price || 0,
      category: item.category || '' // Added category mapping
    })).filter(transaction => transaction.date !== null);

    await Transaction.insertMany(transactions);

    res.status(200).json({ message: 'Database initialized successfully' });
  } catch (error) {
    console.error('Error initializing database:', error);
    res.status(500).json({ message: 'Failed to initialize database' });
  }
});

// API to get transactions with search and pagination
app.get('/transactions', async (req, res) => {
    try {
      const { page = 1, perPage = 10, search = '' } = req.query;
      const pageNumber = parseInt(page, 10);
      const perPageNumber = parseInt(perPage, 10);

      if (isNaN(pageNumber) || isNaN(perPageNumber)) {
        return res.status(400).json({ message: 'Invalid pagination parameters' });
      }

      const query = {
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      };

      if (!isNaN(parseFloat(search)) && isFinite(parseFloat(search))) {
        query.$or.push({ price: parseFloat(search) });
      }

      const transactions = await Transaction.find(query)
        .skip((pageNumber - 1) * perPageNumber)
        .limit(perPageNumber)
        .exec();

      const totalCount = await Transaction.countDocuments(query).exec();

      res.status(200).json({
        transactions,
        totalCount,
        totalPages: Math.ceil(totalCount / perPageNumber),
        currentPage: pageNumber,
        perPage: perPageNumber,
      });
    } catch (error) {
      console.error('Error listing transactions:', error);
      res.status(500).json({ message: `Failed to list transactions: ${error.message}` });
    }
});

// API to get statistics
app.get('/statistics', async (req, res) => {
    try {
      const { month, year } = req.query;
      const monthNumber = parseInt(month, 10);
      const yearNumber = parseInt(year, 10);

      if (isNaN(monthNumber) || isNaN(yearNumber) || monthNumber < 1 || monthNumber > 12) {
        return res.status(400).json({ message: 'Invalid month or year' });
      }

      const startDate = new Date(yearNumber, monthNumber - 1, 1);
      const endDate = new Date(yearNumber, monthNumber, 1);

      const stats = await Transaction.aggregate([
        {
          $match: {
            date: { $gte: startDate, $lt: endDate }
          }
        },
        {
          $facet: {
            totalSaleAmount: [
              {
                $group: {
                  _id: null,
                  total: { $sum: "$amount" }
                }
              }
            ],
            totalSoldItems: [
              {
                $match: { sold: true }
              },
              {
                $count: "count"
              }
            ],
            totalNotSoldItems: [
              {
                $match: { sold: false }
              },
              {
                $count: "count"
              }
            ]
          }
        }
      ]);

      const result = stats[0];
      const totalSaleAmount = result.totalSaleAmount[0]?.total || 0;
      const totalSoldItems = result.totalSoldItems[0]?.count || 0;
      const totalNotSoldItems = result.totalNotSoldItems[0]?.count || 0;

      res.status(200).json({
        totalSaleAmount,
        totalSoldItems,
        totalNotSoldItems
      });
    } catch (error) {
      console.error('Error fetching statistics:', error);
      res.status(500).json({ message: 'Failed to fetch statistics' });
    }
});

// API to get price range data for bar chart
app.get('/price-range', async (req, res) => {
  try {
    const { month } = req.query;
    const monthNumber = parseInt(month, 10);

    if (isNaN(monthNumber) || monthNumber < 1 || monthNumber > 12) {
      return res.status(400).json({ message: 'Invalid month' });
    }

    const startDate = new Date(new Date().getFullYear(), monthNumber - 1, 1);
    const endDate = new Date(new Date().getFullYear(), monthNumber, 1);

    const priceRanges = [
      { min: 0, max: 100 },
      { min: 101, max: 200 },
      { min: 201, max: 300 },
      { min: 301, max: 400 },
      { min: 401, max: 500 },
      { min: 501, max: 600 },
      { min: 601, max: 700 },
      { min: 701, max: 800 },
      { min: 801, max: 900 },
      { min: 901, max: Infinity }
    ];

    const rangeCounts = await Promise.all(
      priceRanges.map(async range => {
        const count = await Transaction.countDocuments({
          date: { $gte: startDate, $lt: endDate },
          price: { $gte: range.min, $lte: range.max }
        }).exec();

        return {
          range: `${range.min} - ${range.max}`,
          count
        };
      })
    );

    res.status(200).json(rangeCounts);
  } catch (error) {
    console.error('Error fetching price range data:', error);
    res.status(500).json({ message: 'Failed to fetch price range data' });
  }
});

// API to get category data for pie chart
app.get('/category-stats', async (req, res) => {
  try {
    const { month } = req.query;
    const monthNumber = parseInt(month, 10);

    if (isNaN(monthNumber) || monthNumber < 1 || monthNumber > 12) {
      return res.status(400).json({ message: 'Invalid month' });
    }

    const startDate = new Date(new Date().getFullYear(), monthNumber - 1, 1);
    const endDate = new Date(new Date().getFullYear(), monthNumber, 1);

    const categoryStats = await Transaction.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lt: endDate }
        }
      },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          category: "$_id",
          count: 1
        }
      }
    ]);

    res.status(200).json(categoryStats);
  } catch (error) {
    console.error('Error fetching category stats:', error);
    res.status(500).json({ message: 'Failed to fetch category stats' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
