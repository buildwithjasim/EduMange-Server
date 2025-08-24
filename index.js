require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: ['http://localhost:5173'], // React frontend
    credentials: true,
  })
);
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send('Unauthorized');

  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send('Forbidden');
    req.user = decoded;
    next();
  });
};

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jkw3zok.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri);

async function run() {
  try {
    // await client.connect();
    const db = client.db('Edu-Manage-System');

    const usersCollection = db.collection('users');
    const classesCollection = db.collection('classes');
    const enrollmentsCollection = db.collection('enrollments');
    const teacherRequestsCollection = db.collection('teacherRequests');
    const assignmentsCollection = db.collection('assignments');
    const submissionsCollection = db.collection('submissions');
    const feedbacksCollection = db.collection('feedbacks');
    const paymentsCollection = db.collection('payments');

    app.post('/jwt', (req, res) => {
      const user = req.body;

      if (!user?.email) {
        return res.status(400).send({ error: 'Email is required' });
      }

      const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '7d' });
      res.send({ token });
    });

    // Stripe setup

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    // Create payment intent endpoint
    app.post('/create-payment-intent', async (req, res) => {
      const { price } = req.body;

      console.log('📦 Received price from frontend:', price);

      if (!price || typeof price !== 'number') {
        return res.status(400).send({ error: 'Invalid price value' });
      }

      const amount = Math.round(price * 100); // Stripe expects amount in cents

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: 'usd',
          payment_method_types: ['card'],
        });

        console.log('✅ PaymentIntent created:', paymentIntent.id);

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        console.error('🧨 Stripe error:', err.message, err);
        res.status(500).send({ error: 'Payment intent failed' });
      }
    });

    // Save payment and enrollment
    app.post('/payments', async (req, res) => {
      try {
        const {
          email,
          classId,
          classTitle,
          teacherName,
          image,
          price,
          enrolledAt,
          transactionId,
        } = req.body;

        const objectClassId = new ObjectId(classId);

        // Step 1: Save payment info
        const paymentDoc = {
          email,
          classId: objectClassId,
          classTitle,
          teacherName,
          image,
          price,
          transactionId,
          paidAt: new Date(enrolledAt),
          method: 'stripe',
          status: 'completed',
        };
        const paymentResult = await paymentsCollection.insertOne(paymentDoc);

        // Step 2: Save enrollment info
        const enrollmentDoc = {
          email,
          classId: objectClassId,
          classTitle,
          teacherName,
          image,
          price,
          enrolledAt: new Date(enrolledAt),
        };
        const enrollResult = await enrollmentsCollection.insertOne(
          enrollmentDoc
        );

        // Step 3: Increment enrolled count in class
        await classesCollection.updateOne(
          { _id: objectClassId },
          { $inc: { enrolled: 1 } }
        );

        res.send({
          success: true,
          message: 'Payment and enrollment successful',
          paymentId: paymentResult.insertedId,
          enrollmentId: enrollResult.insertedId,
        });
      } catch (err) {
        console.error('Payment save error:', err);
        res
          .status(500)
          .send({ success: false, message: 'Internal server error' });
      }
    });

    // POST: Save enrollment info
    app.post('/enrollments', async (req, res) => {
      const enrollmentData = req.body;

      try {
        const result = await enrollmentsCollection.insertOne(enrollmentData);
        res.send(result);
      } catch (err) {
        console.error('❌ Error saving enrollment:', err);
        res.status(500).send({ message: 'Enrollment save failed' });
      }
    });

    // save and update userInfo in db
    app.post('/user', async (req, res) => {
      try {
        const userData = req.body;
        const email = userData.email?.toLowerCase();

        if (!email) {
          return res.status(400).send({ error: 'Email is required' });
        }

        const filter = { email };
        const updateDoc = {
          $setOnInsert: {
            ...userData,
            email,
            role: 'student',
            created_at: new Date().toISOString(),
          },
        };
        const options = { upsert: true };

        const result = await usersCollection.updateOne(
          filter,
          updateDoc,
          options
        );

        res.status(201).send({
          message: result.upsertedCount
            ? 'User created successfully'
            : 'User already existed',
          upsertedId: result.upsertedId || null,
        });
      } catch (err) {
        console.error('❌ Error saving user:', err.message);
        res.status(500).send({ error: 'Internal server error' });
      }
    });

    // get user role

    // ✅ GET single user by email
    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ message: 'User not found' });
      }

      res.send(user);
    });

    app.get('/user/role', async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ error: 'Email is required' });

      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ error: 'User not found' });
      }

      res.send({ role: user.role || 'student' }); // fallback if role is missing
    });

    app.get('/user/role/:email', async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ error: 'User not found' });
      }

      res.send({ role: user.role });
    });

    // Get all approved classes
    app.get('/classes/approved', async (req, res) => {
      try {
        const classes = await classesCollection
          .find({ status: 'approved' })
          .toArray();
        res.send(classes);
      } catch (error) {
        console.error('Failed fetching approved classes:', error);
        res.status(500).send({ error: 'Failed to fetch approved classes' });
      }
    });

    // Get class by ID
    app.get('/classes/:id', async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ error: 'Invalid class ID' });

        const cls = await classesCollection.findOne({ _id: new ObjectId(id) });
        if (!cls) return res.status(404).send({ error: 'Class not found' });

        res.send(cls);
      } catch (error) {
        console.error('Error fetching class:', error);
        res.status(500).send({ error: 'Failed to fetch class details' });
      }
    });

    // Teacher creates a new class
    app.post('/teacher/classes', async (req, res) => {
      try {
        const { title, teacherName, teacherEmail, price, description, image } =
          req.body;

        if (!title || !teacherEmail || !price) {
          return res.status(400).send({ error: 'Missing required fields' });
        }

        const newClass = {
          title,
          teacherName,
          teacherEmail,
          price: parseFloat(price),
          description,
          image,
          status: 'pending',
          createdAt: new Date(),
          enrolled: 0, // initialize enrolled count
        };

        const result = await classesCollection.insertOne(newClass);
        res.send({ insertedId: result.insertedId });
      } catch (error) {
        console.error('Error inserting class:', error);
        res.status(500).send({ error: 'Failed to insert class' });
      }
    });

    // Get classes by teacher email
    app.get('/teacher/classes', async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ error: 'Email required' });

      try {
        const classes = await classesCollection
          .find({ teacherEmail: email })
          .toArray();
        res.send(classes);
      } catch (error) {
        console.error('Error fetching teacher classes:', error);
        res.status(500).send({ error: 'Failed to fetch classes' });
      }
    });

    // users

    app.get('/users', async (req, res) => {
      try {
        const { search = '', page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const query = {
          $or: [
            { displayName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
          ],
        };

        const users = await usersCollection
          .find(query)
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        const count = await usersCollection.countDocuments(query);

        res.send({ users, count });
      } catch (err) {
        res.status(500).send({ error: 'Failed to fetch users' });
      }
    });

    app.patch('/users/admin/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role: 'admin' } }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: 'Failed to update role' });
      }
    });

    // Update class by ID (teacher)
    app.patch('/teacher/classes/:id', async (req, res) => {
      try {
        const classId = req.params.id;
        if (!ObjectId.isValid(classId))
          return res.status(400).send({ error: 'Invalid class ID' });

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

    // Delete class by ID (teacher)
    app.delete('/teacher/classes/:id', async (req, res) => {
      try {
        const classId = req.params.id;
        if (!ObjectId.isValid(classId))
          return res.status(400).send({ error: 'Invalid class ID' });

        const result = await classesCollection.deleteOne({
          _id: new ObjectId(classId),
        });
        res.send(result);
      } catch (error) {
        console.error('Error deleting class:', error);
        res.status(500).send({ error: 'Failed to delete class' });
      }
    });

    // backend for classDetails page

    app.get('/assignments', async (req, res) => {
      try {
        const classId = req.query.classId;
        const result = await assignmentsCollection.find({ classId }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch assignments' });
      }
    });

    app.post('/assignments', async (req, res) => {
      try {
        const { classId, title, deadline, description } = req.body;
        const newAssignment = {
          classId,
          title,
          deadline: new Date(deadline),
          description,
          createdAt: new Date(),
        };
        const result = await assignmentsCollection.insertOne(newAssignment);
        res.send({ insertedId: result.insertedId });
      } catch (error) {
        res.status(500).send({ error: 'Failed to create assignment' });
      }
    });

    app.get('/submissions/count', async (req, res) => {
      try {
        const classId = req.query.classId;
        const count = await submissionsCollection.countDocuments({ classId });
        res.send({ count });
      } catch (error) {
        res.status(500).send({ error: 'Failed to count submissions' });
      }
    });

    // PATCH /assignments/:id/increment
    app.patch('/assignments/:id/increment', async (req, res) => {
      const id = req.params.id;
      const result = await assignmentsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { submissionCount: 1 } }
      );
      res.send(result);
    });

    // POST /submissions
    app.post('/submissions', async (req, res) => {
      const result = await submissionsCollection.insertOne(req.body);
      res.send(result);
    });

    // POST /feedback
    app.post('/feedback', async (req, res) => {
      try {
        const {
          classId,
          description,
          rating,
          studentEmail,
          studentName,
          studentImage,
          createdAt,
        } = req.body;

        // Validation
        if (
          !classId ||
          !description ||
          typeof rating !== 'number' ||
          !studentEmail ||
          !createdAt
        ) {
          return res.status(400).send({ message: 'Missing required fields' });
        }

        const feedbackDoc = {
          classId,
          description,
          rating,
          studentEmail,
          studentName: studentName || 'Anonymous',
          studentImage:
            studentImage || 'https://i.ibb.co/4gM3vTQ/default-avatar.png',
          createdAt: new Date(createdAt),
        };

        const result = await feedbacksCollection.insertOne(feedbackDoc);
        res.send({
          success: true,
          message: 'Feedback submitted successfully',
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error('❌ Feedback insert error:', err);
        res
          .status(500)
          .send({ success: false, message: 'Internal server error' });
      }
    });

    // In your Express backend
    app.get('/feedback', async (req, res) => {
      try {
        const feedbacks = await feedbacksCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(feedbacks);
      } catch (error) {
        res.status(500).send({ message: 'Failed to fetch feedbacks' });
      }
    });

    // GET /class-progress/:id
    app.get('/class-progress/:id', async (req, res) => {
      try {
        const classId = req.params.id;

        const [enrolledCount, assignmentCount, submissionCount] =
          await Promise.all([
            enrollmentsCollection.countDocuments({ classId }),
            assignmentsCollection.countDocuments({ classId }),
            submissionsCollection.countDocuments({ classId }),
          ]);

        res.send({ enrolledCount, assignmentCount, submissionCount });
      } catch (error) {
        res.status(500).send({ error: 'Failed to get class progress' });
      }
    });

    // Admin get all classes
    app.get('/admin/classes', async (req, res) => {
      try {
        const classes = await classesCollection.find().toArray();
        res.send(classes);
      } catch (error) {
        console.error('Error fetching classes:', error);
        res.status(500).send({ error: 'Failed to fetch classes' });
      }
    });

    // Admin approve class
    app.patch('/admin/classes/approve/:id', async (req, res) => {
      try {
        const classId = req.params.id;
        if (!ObjectId.isValid(classId))
          return res.status(400).send({ error: 'Invalid class ID' });

        const result = await classesCollection.updateOne(
          { _id: new ObjectId(classId) },
          { $set: { status: 'approved' } }
        );
        res.send(result);
      } catch (error) {
        console.error('Error approving class:', error);
        res.status(500).send({ error: 'Failed to approve class' });
      }
    });

    // Admin reject class
    app.patch('/admin/classes/reject/:id', async (req, res) => {
      try {
        const classId = req.params.id;
        if (!ObjectId.isValid(classId))
          return res.status(400).send({ error: 'Invalid class ID' });

        const result = await classesCollection.updateOne(
          { _id: new ObjectId(classId) },
          { $set: { status: 'rejected' } }
        );
        res.send(result);
      } catch (error) {
        console.error('Error rejecting class:', error);
        res.status(500).send({ error: 'Failed to reject class' });
      }
    });

    app.get('/enrollments', async (req, res) => {
      try {
        const email = req.query.email;
        const enrollments = await enrollmentsCollection
          .aggregate([
            { $match: { email } },
            {
              $lookup: {
                from: 'classes',
                localField: 'classId',
                foreignField: '_id',
                as: 'classInfo',
              },
            },
            { $unwind: '$classInfo' },
            {
              $project: {
                _id: 1,
                email: 1,
                enrolledAt: 1,
                classId: 1,
                title: '$classInfo.title',
                image: '$classInfo.image',
                teacherName: '$classInfo.teacherName',
              },
            },
          ])
          .toArray();

        res.send(enrollments);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch enrollments' });
      }
    });

    app.get('/assignments/by-class/:classId', async (req, res) => {
      try {
        const classId = req.params.classId;
        const assignments = await assignmentsCollection
          .find({ classId })
          .toArray();
        res.send(assignments);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch assignments' });
      }
    });

    app.post('/submissions', async (req, res) => {
      try {
        const { assignmentId, classId, studentEmail, answer } = req.body;

        const newSubmission = {
          assignmentId,
          classId,
          studentEmail,
          answer,
          submittedAt: new Date(),
        };

        await submissionCollection.insertOne(newSubmission);

        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ error: 'Submission failed' });
      }
    });
    app.post('/feedbacks', async (req, res) => {
      try {
        const { classId, studentEmail, description, rating } = req.body;
        const newFeedback = {
          classId,
          studentEmail,
          description,
          rating,
          createdAt: new Date(),
        };
        await feedbacksCollection.insertOne(newFeedback);
        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ error: 'Failed to submit feedback' });
      }
    });

    // Health check
    app.get('/', (req, res) => {
      res.send('Edu Platform Backend is Running');
    });

    // Submit teacher request
    app.post('/teacher/request', async (req, res) => {
      try {
        const { email, name, photo, experience, title, category } = req.body;

        if (!email || !name) {
          return res.status(400).send({ error: 'Missing required fields' });
        }

        // Check if request exists
        const existing = await teacherRequestsCollection.findOne({ email });
        if (existing) {
          return res.status(400).send({ error: 'Request already exists' });
        }

        const newRequest = {
          email,
          name,
          photo,
          experience,
          title,
          category,
          status: 'pending',
          createdAt: new Date(),
        };

        const result = await teacherRequestsCollection.insertOne(newRequest);
        res.send({ insertedId: result.insertedId });
      } catch (error) {
        console.error('Error submitting teacher request:', error);
        res.status(500).send({ error: 'Failed to submit request' });
      }
    });

    // Get teacher request by email
    app.get('/teacher/request', async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) return res.status(400).send({ error: 'Email required' });

        const request = await teacherRequestsCollection.findOne({ email });
        res.send(request);
      } catch (error) {
        console.error('Error fetching teacher request:', error);
        res.status(500).send({ error: 'Failed to fetch request' });
      }
    });

    // Resend rejected request
    app.patch('/teacher/request/resend', async (req, res) => {
      try {
        const { email } = req.body;
        if (!email) return res.status(400).send({ error: 'Email required' });

        const filter = { email, status: 'rejected' };
        const update = { $set: { status: 'pending', createdAt: new Date() } };
        const result = await teacherRequestsCollection.updateOne(
          filter,
          update
        );

        if (result.modifiedCount > 0) {
          res.send({ message: 'Request resent successfully' });
        } else {
          res
            .status(404)
            .send({ error: 'No rejected request found to resend' });
        }
      } catch (error) {
        console.error('Error resending teacher request:', error);
        res.status(500).send({ error: 'Failed to resend request' });
      }
    });

    // Admin get all teacher requests
    app.get('/admin/teacher-requests', async (req, res) => {
      try {
        const requests = await teacherRequestsCollection.find().toArray();
        res.send(requests);
      } catch (error) {
        console.error('Error fetching teacher requests:', error);
        res.status(500).send({ error: 'Failed to fetch teacher requests' });
      }
    });

    // Admin approve teacher request
    app.patch('/admin/teacher-requests/approve/:id', async (req, res) => {
      try {
        const requestId = req.params.id;
        if (!ObjectId.isValid(requestId))
          return res.status(400).send({ error: 'Invalid request ID' });

        const request = await teacherRequestsCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!request)
          return res.status(404).send({ error: 'Teacher request not found' });
        if (request.status === 'rejected') {
          return res
            .status(400)
            .send({ error: 'Cannot approve a rejected request' });
        }

        await teacherRequestsCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status: 'accepted' } }
        );

        await usersCollection.updateOne(
          { email: request.email },
          { $set: { role: 'teacher' } }
        );

        res.send({ message: 'Teacher request approved and user role updated' });
      } catch (error) {
        console.error('Error approving teacher request:', error);
        res.status(500).send({ error: 'Failed to approve teacher request' });
      }
    });

    // Admin reject teacher request
    app.patch('/admin/teacher-requests/reject/:id', async (req, res) => {
      try {
        const requestId = req.params.id;
        if (!ObjectId.isValid(requestId))
          return res.status(400).send({ error: 'Invalid request ID' });

        const request = await teacherRequestsCollection.findOne({
          _id: new ObjectId(requestId),
        });
        if (!request)
          return res.status(404).send({ error: 'Teacher request not found' });
        if (request.status === 'accepted') {
          return res
            .status(400)
            .send({ error: 'Cannot reject an accepted request' });
        }

        const result = await teacherRequestsCollection.updateOne(
          { _id: new ObjectId(requestId) },
          { $set: { status: 'rejected' } }
        );

        res.send(result);
      } catch (error) {
        console.error('Error rejecting teacher request:', error);
        res.status(500).send({ error: 'Failed to reject teacher request' });
      }
    });

    // status section
    app.get('/stats/total-users', async (req, res) => {
      const totalUsers = await usersCollection.estimatedDocumentCount();
      res.send({ totalUsers });
    });

    app.get('/stats/total-classes', async (req, res) => {
      const totalClasses = await classesCollection.countDocuments({
        status: 'approved',
      });
      res.send({ totalClasses });
    });

    app.get('/stats/total-enrollments', async (req, res) => {
      const totalEnrollments =
        await enrollmentsCollection.estimatedDocumentCount();
      res.send({ totalEnrollments });
    });

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

run();
