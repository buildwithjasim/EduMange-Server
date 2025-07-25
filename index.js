const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jkw3zok.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db('Edu-Manage-System');

    const classesCollection = db.collection('classes');

    app.get('/', (req, res) => {
      res.send('Edu Platform Backend is Running');
    });

    // TODO: add auth, classes, user routes

    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error(error);
  }
}

run();
