const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const app = express();
dotenv.config();

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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
  }
});

async function run() {
  try {
    await client.connect();

    const db = client.db("nexPrompt_db");
    const promptCollection = db.collection('prompts');

    app.get('/api/prompts', async(req,res)=>{
      const result = await promptCollection.find().toArray();
      res.send(result);
    });

    app.post('/api/prompts', async(req,res) =>{
      const prompt = req.body;
      const newPrompt = {
        ...prompt,
        createdAt: new Date()
      }

      const result = await promptCollection.insertOne(newPrompt);
      res.json(result);
    });

    app.patch('/api/prompts/:id', async(req,res)=>{
      const id = req.params.id;
      const updatedData = req.body;

      const result = await promptCollection.updateOne(
        {_id: new ObjectId(id)},
        {$set: updatedData}
      );
      res.send(result);
    });

    app.delete('/api/prompts/:id', async(req,res)=>{
      const id = req.params.id;
      const result = await promptCollection.deleteOne({
        _id: new ObjectId(id)
      })
      res.send(result);
    });

    app.get('/api/prompts/:userId', async(req,res)=>{
      const userId = req.params.userId;
      const result = await promptCollection.find({creatorsId: userId}).toArray();
      res.send(result);
    });

    app.get('/api/prompts/:id', async(req,res)=>{
      const id = req.params.id;
      const query = {
        _id: new ObjectId(id),
      };
      const result = await promptCollection.find(query);
      res.send(result);
    })

















    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});