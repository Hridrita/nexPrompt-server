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
    const subscriptionCollection = db.collection("subscriptions");

    //prompt related api's

    // app.get("/api/prompts", async (req, res) => {
    //   const result = await promptCollection.find().toArray();
    //   res.send(result);
    // });

    app.get("/api/prompts", async (req, res) => {
      const { search, category, aiTool, difficulty, sort } = req.query;

      // const query = {};

      const query = { status: "approved" };

      if (search) {
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          { tags: { $regex: search, $options: "i" } },
          { aiTool: { $regex: search, $options: "i" } },
        ];
      }
      if (category) query.category = { $regex: `^${category}$`, $options: "i" };
      if (aiTool) query.aiTool = { $regex: `^${aiTool}$`, $options: "i" };
      if (difficulty)
        query.difficulty = { $regex: `^${difficulty}$`, $options: "i" };

      let sortObj = {};
      if (sort === "popular") sortObj = { rating: -1 };
      else if (sort === "copied") sortObj = { copyCount: -1 };
      else if (sort === "latest") sortObj = { createdAt: -1 };

      const result = await promptCollection.find(query).sort(sortObj).toArray();
      res.send(result);
    });

    app.post("/api/prompts", async (req, res) => {
      
      const prompt = req.body;
      const creatorId = prompt.creatorsId;

      const user = await userCollection.findOne({ _id: new ObjectId(creatorId) });

      if (user?.plan !== "premium") {
    const promptCount = await promptCollection.countDocuments({ creatorsId: creatorId });
    
    if (promptCount >= 3) {
      return res.status(403).json({ 
        error: "Limit reached", 
        message: "You have reached the limit of 3 prompts. Please upgrade to premium." 
      });
    }
  }
      const newPrompt = {
  ...prompt,
  copyCount: 0,           
  status: "pending",     
  createdAt: new Date(),
  updatedAt: new Date(),  
  reviews: [],            
  rating: 0,              
  bookmarkCount: 0        
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

    // user specigiq review get

app.get("/api/reviews/user", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.send([]);

  const prompts = await promptCollection.find(
    { "reviews.email": email },
    { projection: { title: 1, reviews: 1 } }
  ).toArray();

  const userReviews = prompts.flatMap(p =>
    (p.reviews || [])
      .filter(r => r.email === email)
      .map(r => ({ ...r, promptTitle: p.title, promptId: p._id }))
  );

  res.send(userReviews);
});

    //report realted api

    app.post("/api/reports", async (req, res) => {
      const { promptId, promptTitle, creatorId, reason, description } =
        req.body;

      const report = {
        promptId,
        promptTitle,
        creatorId,
        reason,
        description: description || "",
        createdAt: new Date(),
      };

      const result = await reportCollection.insertOne(report);
      res.send(result);
    });

    //subscription related api

    app.post("/api/subscription", async (req, res) => {
      const { email, plan, stripeSessionId } = req.body;

      const subscription = {
        email,
        plan,
        stripeSessionId,
        subscribedAt: new Date(),
        status: "active",
      };

      const result = await subscriptionCollection.insertOne(subscription);
      res.send(result);
    });

    // user plan update

    app.patch("/api/users/plan", async (req, res) => {
      const { email, plan } = req.body;
      const result = await userCollection.updateOne(
        { email },
        { $set: { plan } },
      );
      res.send(result);
    });


    // ============= ADMIN API'S =============


app.get("/api/admin/prompts", async (req, res) => {
  const { status } = req.query;
  const query = {};
  
  if (status && status !== "all") {
    query.status = status;
  }

  const result = await promptCollection
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();
  
  
  const promptsWithCreator = await Promise.all(
    result.map(async (prompt) => {
      const creator = await userCollection.findOne(
        { _id: new ObjectId(prompt.creatorsId) },
        { projection: { name: 1, email: 1, plan: 1 } }
      );
      return { ...prompt, creator };
    })
  );

  res.send(promptsWithCreator);
});


app.patch("/api/admin/prompts/:id", async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const result = await promptCollection.updateOne(
    { _id: new ObjectId(id) },
    { 
      $set: { 
        status: status,
        updatedAt: new Date(),
        ...(status === "rejected" ? { rejectionDate: new Date() } : { approvedDate: new Date() })
      } 
    }
  );

  if (result.modifiedCount === 0) {
    return res.status(404).json({ error: "Prompt not found" });
  }

  const updatedPrompt = await promptCollection.findOne({ _id: new ObjectId(id) });
  res.json({ 
    message: `Prompt ${status} successfully`,
    prompt: updatedPrompt 
  });
});


app.get("/api/admin/stats", async (req, res) => {
  const total = await promptCollection.countDocuments();
  const pending = await promptCollection.countDocuments({ status: "pending" });
  const approved = await promptCollection.countDocuments({ status: "approved" });
  const rejected = await promptCollection.countDocuments({ status: "rejected" });
  
  
  const freeUsers = await userCollection.find({ plan: { $ne: "premium" } }).toArray();
  let usersAtLimit = 0;
  
  for (const user of freeUsers) {
    const count = await promptCollection.countDocuments({ creatorsId: user._id.toString() });
    if (count >= 3) usersAtLimit++;
  }

  res.json({
    total,
    pending,
    approved,
    rejected,
    usersAtLimit
  });
});

// ============= ADD THESE APIs =============

// 1. Update prompt status with user notification
app.patch("/api/admin/prompts/:id/status", async (req, res) => {
  const id = req.params.id;
  const { status, rejectionReason } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  // Get the prompt first
  const prompt = await promptCollection.findOne({ _id: new ObjectId(id) });
  if (!prompt) {
    return res.status(404).json({ error: "Prompt not found" });
  }

  // Update prompt status
  const updateData = {
    status: status,
    updatedAt: new Date(),
  };

  if (status === "approved") {
    updateData.approvedAt = new Date();
  } else if (status === "rejected") {
    updateData.rejectedAt = new Date();
    updateData.rejectionReason = rejectionReason || "Did not meet platform guidelines";
  }

  const result = await promptCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updateData }
  );

  if (result.modifiedCount === 0) {
    return res.status(404).json({ error: "Prompt not found" });
  }

  const updatedPrompt = await promptCollection.findOne({ _id: new ObjectId(id) });

  // Also update user's prompt count if approved
  if (status === "approved") {
    // User already has the prompt in their list, no need to update count
    // But we can log or notify
    console.log(`Prompt ${prompt.title} approved for user ${prompt.creatorsId}`);
  }

  res.json({ 
    message: `Prompt ${status} successfully`,
    prompt: updatedPrompt 
  });
});

// 2. Get pending prompts count for admin
app.get("/api/admin/pending-count", async (req, res) => {
  const pendingCount = await promptCollection.countDocuments({ status: "pending" });
  res.json({ pendingCount });
});


// server.js - এই API গুলো যোগ করুন

// ============= NEW ADMIN APIS =============

// 1. Delete prompt (admin)
app.delete("/api/admin/prompts/:id", async (req, res) => {
  const id = req.params.id;
  
  try {
    // First get the prompt to notify user
    const prompt = await promptCollection.findOne({ _id: new ObjectId(id) });
    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    const result = await promptCollection.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    // Send notification to user
    await sendNotification(prompt.creatorsId, {
      type: "deleted",
      title: prompt.title,
      message: `Your prompt "${prompt.title}" has been deleted by admin.`,
    });

    res.json({ 
      message: "Prompt deleted successfully",
      deletedId: id 
    });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ error: "Failed to delete prompt" });
  }
});

// 2. Feature/Unfeature prompt
app.patch("/api/admin/prompts/:id/feature", async (req, res) => {
  const id = req.params.id;
  const { featured } = req.body; // boolean

  const result = await promptCollection.updateOne(
    { _id: new ObjectId(id) },
    { 
      $set: { 
        featured: featured || false,
        featuredAt: featured ? new Date() : null,
        updatedAt: new Date()
      } 
    }
  );

  if (result.modifiedCount === 0) {
    return res.status(404).json({ error: "Prompt not found" });
  }

  const updatedPrompt = await promptCollection.findOne({ _id: new ObjectId(id) });
  res.json({ 
    message: featured ? "Prompt featured successfully" : "Prompt unfeatured successfully",
    prompt: updatedPrompt 
  });
});

// 3. Get all featured prompts
app.get("/api/prompts/featured", async (req, res) => {
  const result = await promptCollection
    .find({ featured: true, status: "approved" })
    .sort({ featuredAt: -1 })
    .toArray();
  res.send(result);
});

// Helper function to send notification
async function sendNotification(userId, data) {
  const db = client.db("nexPrompt_db");
  const notificationCollection = db.collection("notifications");
  
  await notificationCollection.insertOne({
    userId: userId,
    ...data,
    read: false,
    createdAt: new Date()
  });
}

// 4. Get user notifications
app.get("/api/notifications/:userId", async (req, res) => {
  const userId = req.params.userId;
  const notifications = await notificationCollection
    .find({ userId: userId })
    .sort({ createdAt: -1 })
    .toArray();
  res.send(notifications);
});

// 5. Mark notification as read
app.patch("/api/notifications/:id/read", async (req, res) => {
  const id = req.params.id;
  const result = await notificationCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { read: true } }
  );
  res.send(result);
});

// Update existing status API with notification
app.patch("/api/admin/prompts/:id/status", async (req, res) => {
  const id = req.params.id;
  const { status, rejectionReason } = req.body;

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const prompt = await promptCollection.findOne({ _id: new ObjectId(id) });
  if (!prompt) {
    return res.status(404).json({ error: "Prompt not found" });
  }

  const updateData = {
    status: status,
    updatedAt: new Date(),
  };

  if (status === "approved") {
    updateData.approvedAt = new Date();
    // Send approval notification
    await sendNotification(prompt.creatorsId, {
      type: "approved",
      title: prompt.title,
      message: `✅ Your prompt "${prompt.title}" has been approved and is now live!`,
    });
  } else if (status === "rejected") {
    updateData.rejectedAt = new Date();
    updateData.rejectionReason = rejectionReason || "Did not meet platform guidelines";
    // Send rejection notification with feedback
    await sendNotification(prompt.creatorsId, {
      type: "rejected",
      title: prompt.title,
      message: `❌ Your prompt "${prompt.title}" was rejected.`,
      feedback: updateData.rejectionReason,
    });
  }

  const result = await promptCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: updateData }
  );

  if (result.modifiedCount === 0) {
    return res.status(404).json({ error: "Prompt not found" });
  }

  const updatedPrompt = await promptCollection.findOne({ _id: new ObjectId(id) });
  res.json({ 
    message: `Prompt ${status} successfully`,
    prompt: updatedPrompt 
  });
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
