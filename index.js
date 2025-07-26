require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { MongoClient, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;

const app = express();
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jkw3zok.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db('Edu-Manage-System');
    const usersCollection = db.collection('users');
    const classesCollection = db.collection('classes');
    const enrollmentsCollection = db.collection('enrollments');
    const teacherRequestsCollection = db.collection('teacherRequests');
    const assignmentsCollection = db.collection('assignments');
    const submissionsCollection = db.collection('submissions');
    const feedbacksCollection = db.collection('feedbacks');
    const paymentsCollection = db.collection('payments');

    // POST: Add a new class by teacher
    app.post('/teacher/classes', async (req, res) => {
      try {
        const { title, teacherName, teacherEmail, price, description, image } =
          req.body;

        const newClass = {
          title,
          teacherName,
          teacherEmail,
          price: parseFloat(price),
          description,
          image,
          status: 'pending',
          createdAt: new Date(),
        };

        const result = await classesCollection.insertOne(newClass);
        res.send({ insertedId: result.insertedId });
      } catch (error) {
        console.error('Error inserting class:', error);
        res.status(500).send({ error: 'Failed to insert class' });
      }
    });

    // GET: Classes created by this teacher
    app.get('/teacher/classes', async (req, res) => {
      const email = req.query.email;
      const result = await classesCollection
        .find({ teacherEmail: email })
        .toArray();
      res.send(result);
    });
    // PATCH: Update a class by ID (teacher)
    app.patch('/teacher/classes/:id', async (req, res) => {
      try {
        const classId = req.params.id;
        const updatedData = req.body;

        const result = await classesCollection.updateOne(
          { _id: new ObjectId(classId) },
          { $set: updatedData }
        );

        res.send(result);
      } catch (error) {
        console.error('Error updating class:', error);
        res.status(500).send({ error: 'Failed to update class' });
      }
    });

    // DELETE: Remove a class by ID (teacher)
    app.delete('/teacher/classes/:id', async (req, res) => {
      try {
        const classId = req.params.id;
        const result = await classesCollection.deleteOne({
          _id: new ObjectId(classId),
        });
        res.send(result);
      } catch (error) {
        console.error('Error deleting class:', error);
        res.status(500).send({ error: 'Failed to delete class' });
      }
    });

    app.get('/', (req, res) => {
      res.send('Edu Platform Backend is Running');
    });

    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error(error);
  }
}

run();
