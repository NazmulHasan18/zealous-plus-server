const express = require("express");
const app = express();
const cors = require("cors");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;

// middleware for server
dotenv.config();
const stripe = require("stripe")(process.env.API_SECRET_KEY);
app.use(cors());
app.use(express.json());

// const jwtVerify = (req, res, next) => {
//    const token = req.header("Authorization");
//    if (!token) {
//       return res.status(401).json({ error: "No token provided" });
//    }

//    try {
//       const decoded = jwt.verify(token, process.env.PRIVATE_KEY);
//       Assuming the Stripe API key is stored in the 'stripeApiKey' field of the decoded token
//       const stripeApiKey = decoded.stripeApiKey;
//       req.headers["Authorization"] = `Bearer ${stripeApiKey}`;
//       next();
//    } catch (error) {
//       res.status(401).json({ error: "Invalid token" });
//    }
// };

const jwtVerify = (req, res, next) => {
   console.log("hit");
   const authorization = req.headers.authorization;
   if (!authorization) {
      return res.status(401).send({ error: true, message: "No authorization Token" });
   }
   const token = authorization.split(" ")[1];

   jwt.verify(token, process.env.PRIVATE_KEY, (err, decoded) => {
      if (err) {
         return res.status(401).send({ error: true, message: "Unauthorized User" });
      }
      req.email = decoded.user.email;
      next();
   });
};

// mongoDB starts Here

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.lvw8wzq.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
   serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
   },
});

async function run() {
   try {
      // Connect the client to the server	(optional starting in v4.7)
      // await client.connect();

      // ?here is starting all operations

      const zealousPlusDB = client.db("zealousPlusDB");

      const userCollection = zealousPlusDB.collection("users");
      const quoteCollection = zealousPlusDB.collection("quotes");
      const instructorCollection = zealousPlusDB.collection("instructors");
      const classCollection = zealousPlusDB.collection("classes");
      const studentClassCollection = zealousPlusDB.collection("studentClasses");
      const reviewCollection = zealousPlusDB.collection("reviews");
      const paymentCollection = zealousPlusDB.collection("payments");
      const bookedClassCollection = zealousPlusDB.collection("bookedClasses");

      // !jwt token create and post

      app.post("/jwt", (req, res) => {
         const user = req.body;
         const token = jwt.sign({ user }, process.env.PRIVATE_KEY, { expiresIn: "1h" });
         res.send(token);
      });

      // ?user api here

      app.post("/users", async (req, res) => {
         const user = req.body;
         const existUser = await userCollection.findOne({ email: user.email });
         if (existUser) {
            return res.send("user already exists");
         } else {
            const result = await userCollection.insertOne(user);
            res.send(result);
         }
      });

      app.get("/users", jwtVerify, async (req, res) => {
         const email = req.query.email;
         if (email !== req.email) {
            return res.status(403).send({ error: true, message: "Forbidden access" });
         }
         const result = await userCollection.find({}).toArray();
         res.send(result);
      });

      app.get("/user/:email", jwtVerify, async (req, res) => {
         const email = req.params.email;
         if (email !== req.email) {
            return res.status(403).send({ error: true, message: "Forbidden access" });
         }
         const result = await userCollection.findOne({ email: email });
         res.send(result);
      });

      app.patch("/user/:id", jwtVerify, async (req, res) => {
         const id = req.params.id;
         const role = req.body;
         const email = req.query.email;
         if (email !== req.email) {
            return res.status(403).send({ error: true, message: "Forbidden access" });
         }
         const updateDoc = {
            $set: {
               role: role.role,
            },
         };
         const result = await userCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);
         res.send(result);
      });

      // !for student classes

      app.post("/students_classes", jwtVerify, async (req, res) => {
         const { classes } = req.body;
         const objectIds = classes.map((classs) => new ObjectId(classs._id));
         const paidClasses = await bookedClassCollection.find({ _id: { $in: objectIds } }).toArray();

         const result = await studentClassCollection.insertMany(paidClasses, { ordered: true });

         res.send(result);
      });

      app.post("/selected_class/:id", jwtVerify, async (req, res) => {
         const id = req.params.id;
         const email = req.query.email;

         if (email !== req.email) {
            return res.status(403).send({ error: true, message: "Forbidden access" });
         }

         const findClass = await classCollection.findOne({ _id: new ObjectId(id) });
         findClass.student_email = email;
         findClass.class_id = findClass._id;
         findClass.status = "pending";
         delete findClass._id;
         const result = await bookedClassCollection.insertOne(findClass);
         res.send(result);
      });

      app.get("/selected_classes", jwtVerify, async (req, res) => {
         const email = req.query.email;

         if (email !== req.email) {
            return res.status(403).send({ error: true, message: "Forbidden access" });
         }

         const result = await bookedClassCollection.find({ student_email: email }).toArray();
         res.send(result || []);
      });

      app.delete("/selected_class/:id", jwtVerify, async (req, res) => {
         const id = req.params.id;
         const email = req.query.email;
         if (email !== req.email) {
            return res.status(403).send({ error: true, message: "Forbidden access" });
         }
         const result = await bookedClassCollection.deleteOne({ _id: new ObjectId(id) });
         res.send(result);
      });

      // !Payment for student

      app.post("/create-payment-intent", jwtVerify, async (req, res) => {
         const { price } = req.body;
         const amount = parseInt(price * 100);
         const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: "usd",
            payment_method_types: ["card"],
         });
         res.send({
            clientSecret: paymentIntent.client_secret,
         });
      });

      app.get("/payments/:email", jwtVerify, async (req, res) => {
         const email = req.params.email;
         const result = await paymentCollection.find({ "user.email": email }).sort({ _id: -1 }).toArray();
         res.send(result);
      });

      // !instructor

      app.get("/instructor_classes/:email", jwtVerify, async (req, res) => {
         const email = req.params.email;

         if (email !== req.email) {
            return res.status(403).send({ error: true, message: "Forbidden access" });
         }
         const result = await classCollection.find({ "teacher.email": email }).toArray();
         res.send(result);
      });
      app.get("/single_instructor_classes/:email", async (req, res) => {
         const email = req.params.email;
         const result = await classCollection.find({ "teacher.email": email }).toArray();
         res.send(result);
      });

      // ?its quotes api

      app.get("/quotes", async (req, res) => {
         const quotes = await quoteCollection.find({}).toArray();
         const result = quotes[parseInt(Math.round(Math.random() * 16))];
         res.send(result);
      });

      // ? there are instructor apis

      app.get("/instructors", async (req, res) => {
         const result = await instructorCollection.find({}).sort({ current_students: -1 }).toArray();
         res.send(result);
      });

      app.get("/instructor/:id", async (req, res) => {
         const id = req.params.id;
         const result = await instructorCollection.findOne({ _id: new ObjectId(id) });
         res.send(result);
      });

      // review data here
      app.get("/reviews", async (req, res) => {
         const result = await reviewCollection.find({}).toArray();
         res.send(result);
      });

      app.post("/review", jwtVerify, async (req, res) => {
         const review = req.body;
         const result = await reviewCollection.insertOne(review);
         res.send(result);
      });

      // ?Here popular classes apis

      app.get("/popular_classes", async (req, res) => {
         const result = await classCollection
            .find({ status: "approved" })
            .sort({ current_students: -1 })
            .toArray();

         res.send(result.slice(0, 6));
      });

      app.get("/classes", async (req, res) => {
         const result = await classCollection.find({}).sort({ _id: -1 }).toArray();
         res.send(result);
      });

      // !Payment methods
      app.post("/payments", jwtVerify, async (req, res) => {
         const { payInfo } = req.body;
         const result = await paymentCollection.insertOne(payInfo);
         res.send(result);
      });

      // !add class for instructor

      app.get("/my_classes/:email", jwtVerify, async (req, res) => {
         const email = req.params.email;
         const result = await studentClassCollection.find({ student_email: email }).toArray();
         res.send(result);
      });

      app.post("/add_class", jwtVerify, async (req, res) => {
         const email = req.query.email;
         if (email !== req.email) {
            return res.status(403).send({ error: true, message: "Forbidden access" });
         }
         const classs = req.body;
         const result = await classCollection.insertOne(classs);
         res.send(result);
      });

      app.patch("/class/:id", jwtVerify, async (req, res) => {
         const email = req.query.email;
         const data = req.body;
         const id = req.params.id;
         if (email !== req.email) {
            return res.status(403).send({ error: true, message: "Forbidden access" });
         }

         const updateDoc = {
            $set: {
               status: data.status,
               reviewed: data.reviewed,
            },
         };
         const result = await classCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);

         res.send(result);
      });

      app.patch("/classes", jwtVerify, async (req, res) => {
         const { classes } = req.body;
         const objectIds = classes.map((classs) => new ObjectId(classs.class_id));
         const filter = { _id: { $in: objectIds } };
         const update = { $inc: { current_students: 1 } };
         const findClass = await classCollection.updateMany(filter, update);
         res.send(findClass);
      });

      app.delete("/classes", jwtVerify, async (req, res) => {
         const id = req.query.id;
         const email = req.query.email;
         if (email) {
            const result = await bookedClassCollection.deleteMany({ student_email: email });
            res.send(result);
         } else if (id) {
            const result = await bookedClassCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
         }
      });

      app.patch("/class_feedback/:id", jwtVerify, async (req, res) => {
         const email = req.query.email;
         const data = req.body;
         const id = req.params.id;
         if (email !== req.email) {
            return res.status(403).send({ error: true, message: "Forbidden access" });
         }
         const updateDoc = {
            $set: {
               feedback: data.feedback,
            },
         };

         const result = await classCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);
         res.send(result);
      });

      // Send a ping to confirm a successful connection
      await client.db("admin").command({ ping: 1 });
      console.log("Pinged your deployment. You successfully connected to MongoDB!");
   } finally {
      // Ensures that the client will close when you finish/error
      //   await client.close();
   }
}
run().catch(console.dir);

app.get("/", (req, res) => {
   res.send("Hello Zealous Plus World!");
});

app.listen(port, () => {
   console.log(`Example app listening on port ${port}`);
});
