const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const app = express();
dotenv.config();

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = process.env.MONGO_URI;
PORT = process.env.PORT;

app.get("/", (req, res) => {
  res.send("server is running fine!");
});

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("nexPrompt_db");
    const promptCollection = db.collection("prompts");
    const userCollection = db.collection("user");
    const bookmarkCollection = db.collection("bookmark");
    const reportCollection = db.collection("reports");

    //prompt related api's

    app.get("/api/prompts", async (req, res) => {
      const result = await promptCollection.find().toArray();
      res.send(result);
    });

    app.post("/api/prompts", async (req, res) => {
      const prompt = req.body;
      const newPrompt = {
        ...prompt,
        createdAt: new Date(),
      };

      const result = await promptCollection.insertOne(newPrompt);
      res.json(result);
    });

    app.patch("/api/prompts/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const result = await promptCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData },
      );
      res.send(result);
    });

    app.delete("/api/prompts/:id", async (req, res) => {
      const id = req.params.id;
      const result = await promptCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.get("/api/prompts/creator/:userId", async (req, res) => {
      const userId = req.params.userId;
      const result = await promptCollection
        .find({ creatorsId: userId })
        .toArray();
      res.send(result);
    });

    app.get("/api/prompts/:id", async (req, res) => {
      const id = req.params.id;
      const query = {
        _id: new ObjectId(id),
      };
      const prompt = await promptCollection.findOne(query);

      const creator = await userCollection.findOne({
        _id: new ObjectId(prompt.creatorsId),
      });
      console.log("creator", creator);

      res.send({ ...prompt, creator });
    });

    //bookmark related api's

    app.post("/api/bookmark", async (req, res) => {
      const bookmarkData = req.body;
      const result = await bookmarkCollection.insertOne(bookmarkData);
      res.send(result);
    });

    app.patch("/api/prompts/:id/bookmark", async (req, res) => {
      const id = req.params.id;
      const result = await promptCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { bookmarkCount: 1 } },
      );
      res.send(result);
    });

    app.delete("/api/bookmark/remove", async (req, res) => {
      const { promptId, userId } = req.body;
      const result = await bookmarkCollection.deleteOne({ promptId, userId });
      res.send(result);
    });

    app.patch("/api/prompts/:id/bookmark/decrement", async (req, res) => {
      const id = req.params.id;
      const result = await promptCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { bookmarkCount: -1 } },
      );
      res.send(result);
    });

    app.get("/api/bookmark/check", async (req, res) => {
      const { userId, promptId } = req.query;
      const existing = await bookmarkCollection.findOne({ userId, promptId });
      res.json({ bookmarked: !!existing });
    });

    app.get("/api/bookmark/user/:userId", async (req, res) => {
      const userId = req.params.userId;
      const result = await bookmarkCollection
        .find({ userId: userId })
        .toArray();
      res.send(result);
    });

    //copy related api

    app.patch("/api/prompts/:id/copy", async (req, res) => {
      const id = req.params.id;
      const result = await promptCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { copyCount: 1 } },
      );
      res.send(result);
    });

    //review related api

    app.post("/api/prompts/:id/review", async (req, res) => {
      const id = req.params.id;
      const { name, email, rating, comment } = req.body;

      const review = {
        _id: new ObjectId(),
        name,
        email,
        rating: Number(rating),
        comment,
        date: new Date().toLocaleDateString("en-US", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      };

      const result = await promptCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $push: { reviews: review },
          $set: { rating: 0 }, // recalc below
        },
      );

      
      const prompt = await promptCollection.findOne({ _id: new ObjectId(id) });
      const avg =
        prompt.reviews.reduce((sum, r) => sum + r.rating, 0) /
        prompt.reviews.length;

      await promptCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { rating: avg } },
      );

      res.send(result);
    });

    //report realted api

    app.post('/api/reports', async (req, res) => {
  const { promptId, promptTitle, creatorId, reason, description } = req.body;
  
  const report = {
    promptId,
    promptTitle,
    creatorId,
    reason,
    description: description || "",
    createdAt: new Date()
  };

  const result = await reportCollection.insertOne(report);
  res.send(result);
});


























    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});
