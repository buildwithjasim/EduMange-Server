const express = require('express');
const cors = require('cors');
// const jwt = require('jsonwebtoken');
// const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// const uri = process.env.MONGO_URI;
// const client = new MongoClient(uri);

app.get('/', (req, res) => {
  res.send('Edu Platform Backend is Running');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
