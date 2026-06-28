const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const app = express();
dotenv.config();

app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const uri = process.env.MONGO_URI;
PORT = process.env.PORT;

app.get("/", (req, res) => {
  res.send("server is running fine!");
});

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: false,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL("http://localhost:3000/api/auth/jwks")
)


const verifyRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ message: "forbidden" });
  }
  next();
};

const verifyInternal = (req, res, next) => {
  const secret = req.headers['x-internal-secret'];
  if (secret !== process.env.INTERNAL_SECRET) {
    return res.status(403).json({ message: "forbidden" });
  }
  next();
};


// async function run() {
//   try {
//     await client.connect();

client.connect(() => {console.log('connecting to mongodb')}).catch(console.dir)

    const db = client.db("nexPrompt_db");
    const promptCollection = db.collection("prompts");
    const userCollection = db.collection("user");
    const bookmarkCollection = db.collection("bookmark");
    const reportCollection = db.collection("reports");
    const subscriptionCollection = db.collection("subscriptions");
    const notificationCollection = db.collection("notifications");

    const verifyToken = async(req,res,next) =>{
  const authHeader = req?.headers.authorization
  if(!authHeader){
    return res.status(401).json({message: "unauthorized"})
  }
  const token = authHeader.split(" ")[1];
  if(!token){
    return res.status(401).json({message: "unauthorized"})
  }
  // console.log(token);

  try{
    const {payload} = await jwtVerify(token, JWKS);
    const user = await userCollection.findOne({ email: payload.email });
    if (!user) return res.status(401).json({ message: "unauthorized" });
    req.user = user;
  // console.log(payload);
  next()
  } catch (error) {
    return res.status(403).json({message: "forbidden"})
  }
}

    //prompt related api's

    // app.get("/api/prompts", async (req, res) => {
    //   const result = await promptCollection.find().toArray();
    //   res.send(result);
    // });

    // app.get("/api/prompts", async (req, res) => {
    //   const { search, category, aiTool, difficulty, sort } = req.query;

    //   // const query = {};

    //   const query = { status: "approved" };

    //   if (search) {
    //     query.$or = [
    //       { title: { $regex: search, $options: "i" } },
    //       { tags: { $regex: search, $options: "i" } },
    //       { aiTool: { $regex: search, $options: "i" } },
    //     ];
    //   }
    //   if (category) query.category = { $regex: `^${category}$`, $options: "i" };
    //   if (aiTool) query.aiTool = { $regex: `^${aiTool}$`, $options: "i" };
    //   if (difficulty)
    //     query.difficulty = { $regex: `^${difficulty}$`, $options: "i" };

    //   let sortObj = {};
    //   if (sort === "popular") sortObj = { rating: -1 };
    //   else if (sort === "copied") sortObj = { copyCount: -1 };
    //   else if (sort === "latest") sortObj = { createdAt: -1 };

    //   const result = await promptCollection.find(query).sort(sortObj).toArray();
    //   res.send(result);
    // });

    app.post("/api/prompts",verifyToken,verifyRole("creator","user"), async (req, res) => {
      const prompt = req.body;
      const creatorId = prompt.creatorsId;

      const user = await userCollection.findOne({
        _id: new ObjectId(creatorId),
      });

      if (user?.plan !== "premium") {
        const promptCount = await promptCollection.countDocuments({
          creatorsId: creatorId,
        });

        if (promptCount >= 3) {
          return res.status(403).json({
            error: "Limit reached",
            message:
              "You have reached the limit of 3 prompts. Please upgrade to premium.",
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
        bookmarkCount: 0,
      };

      const result = await promptCollection.insertOne(newPrompt);

      //for notification
      const admins = await userCollection.find({ role: "admin" }).toArray();
      for (const admin of admins) {
        await sendNotification(admin._id.toString(), {
          type: "pending",
          title: newPrompt.title,
          message: `📝 New prompt "${newPrompt.title}" submitted by ${user.name || user.email} needs review`,
          promptId: result.insertedId.toString(),
        });
      }
      res.json(result);
    });

    app.patch("/api/prompts/:id",verifyToken,verifyRole("creator","user"), async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const result = await promptCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData },
      );
      res.send(result);
    });

    app.delete("/api/prompts/:id",verifyToken,verifyRole("creator","user"), async (req, res) => {
      const id = req.params.id;
      const result = await promptCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.get("/api/prompts/creator/:userId",verifyToken,verifyRole("creator","user"), async (req, res) => {
      const userId = req.params.userId;
      const result = await promptCollection
        .find({ creatorsId: userId })
        .toArray();
      res.send(result);
    });

    // 3. Get all featured prompts
    app.get("/api/prompts/featured", async (req, res) => {
      const result = await promptCollection
        .find({ featured: true, status: "approved" })
        .sort({ featuredAt: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    // to get specifiq prompt details
    
app.get("/api/prompts/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const prompt = await promptCollection.findOne({ _id: new ObjectId(id) });

    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found" });
    }

    const user = req.user;
    
    
    if (prompt.visibility === "private") {
      //db thk latest user check
      const latestUser = await userCollection.findOne({ 
        _id: new ObjectId(user._id) 
      });
      
      //premium na hole 403
      if (!latestUser || latestUser.plan !== "premium") {
        return res.status(403).json({ 
          error: "Premium subscription required",
          isLocked: true,
          message: "This is a private premium prompt. Subscribe to unlock."
        });
      }
    }

    const creator = await userCollection.findOne({
      _id: new ObjectId(prompt.creatorsId),
    });

    res.send({ 
      ...prompt, 
      creator,
      userPlan: user.plan
    });
    
  } catch (error) {
    console.error("Error fetching prompt:", error);
    res.status(500).json({ error: "Failed to fetch prompt" });
  }
});



//user plan check
app.get("/api/users/:userId/plan", verifyToken, async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await userCollection.findOne(
      { _id: new ObjectId(userId) },
      { projection: { plan: 1, name: 1, email: 1 } }
    );
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json({ 
      plan: user.plan || 'free',
      name: user.name,
      email: user.email
    });
  } catch (error) {
    console.error("Error fetching user plan:", error);
    res.status(500).json({ error: "Failed to fetch user plan" });
  }
});

    //bookmark related api's

    app.post("/api/bookmark",verifyToken,verifyRole("user"), async (req, res) => {
      const bookmarkData = req.body;
      const result = await bookmarkCollection.insertOne(bookmarkData);
      res.send(result);
    });

    app.patch("/api/prompts/:id/bookmark",verifyToken,verifyRole("user"), async (req, res) => {
      const id = req.params.id;
      const result = await promptCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { bookmarkCount: 1 } },
      );
      res.send(result);
    });

    app.delete("/api/bookmark/remove",verifyToken,verifyRole("user"), async (req, res) => {
      const { promptId, userId } = req.body;
      const result = await bookmarkCollection.deleteOne({ promptId, userId });
      res.send(result);
    });

    app.patch("/api/prompts/:id/bookmark/decrement",verifyToken,verifyRole("user"), async (req, res) => {
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

    app.get("/api/bookmark/user/:userId",verifyToken,verifyRole("user"), async (req, res) => {
      const userId = req.params.userId;
      const result = await bookmarkCollection
        .find({ userId: userId })
        .toArray();
      res.send(result);
    });

    //copy related api

    app.patch("/api/prompts/:id/copy",verifyToken,verifyRole("user"), async (req, res) => {
      const id = req.params.id;
      const result = await promptCollection.updateOne(
        { _id: new ObjectId(id) },
        { $inc: { copyCount: 1 } },
      );
      res.send(result);
    });

    //review related api

    app.post("/api/prompts/:id/review",verifyToken,verifyRole("user"), async (req, res) => {
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

    // user specifiq review get

    app.get("/api/reviews/user",verifyToken,verifyRole("user"), async (req, res) => {
      const { email } = req.query;
      if (!email) return res.send([]);

      const prompts = await promptCollection
        .find(
          { "reviews.email": email },
          { projection: { title: 1, reviews: 1 } },
        )
        .toArray();

      const userReviews = prompts.flatMap((p) =>
        (p.reviews || [])
          .filter((r) => r.email === email)
          .map((r) => ({ ...r, promptTitle: p.title, promptId: p._id })),
      );

      res.send(userReviews);
    });

    //report realted api

    app.post("/api/reports",verifyToken,verifyRole("user"), async (req, res) => {
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

app.post("/api/subscription", verifyInternal, async (req, res) => {
  const { email, plan, stripeSessionId } = req.body;

  console.log("📝 Subscription request:", { email, plan, stripeSessionId });

  if (!email || !plan) {
    return res.status(400).json({
      success: false,
      error: "Email and plan are required",
    });
  }

  try {
    const userUpdateResult = await userCollection.updateOne(
      { email: email },
      { 
        $set: { 
          plan: "premium",
          updatedAt: new Date() 
        } 
      }
    );

    console.log("User update result:", userUpdateResult);

    if (userUpdateResult.modifiedCount === 0) {
      
      const userExists = await userCollection.findOne({ email: email });
      if (!userExists) {
        return res.status(404).json({
          success: false,
          error: "User not found"
        });
      }
      
      console.log("User exists but not updated:", userExists);
    }

    
    const subscription = {
      email,
      plan,
      stripeSessionId,
      subscribedAt: new Date(),
      status: "active",
    };

    const result = await subscriptionCollection.insertOne(subscription);

    
    const updatedUser = await userCollection.findOne({ email: email });

    console.log("Subscription successful for:", email);

    res.json({
      success: true,
      message: "Subscription added successfully",
      insertedId: result.insertedId,
      user: {
        plan: updatedUser?.plan || "premium",
        name: updatedUser?.name,
        email: updatedUser?.email
      }
    });
  } catch (error) {
    console.error("Subscription error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process subscription"
    });
  }
});

    // user plan update

    app.patch("/api/users/plan",verifyInternal, async (req, res) => {
      const { email, plan } = req.body;
      const result = await userCollection.updateOne(
        { email },
        { $set: { plan } },
      );
      res.send(result);
    });

    // admin apis

    // app.get("/api/admin/prompts", async (req, res) => {
    //   const { status } = req.query;
    //   const query = {};

    //   if (status && status !== "all") {
    //     query.status = status;
    //   }

    //   const result = await promptCollection
    //     .find(query)
    //     .sort({ createdAt: -1 })
    //     .toArray();

    //   const promptsWithCreator = await Promise.all(
    //     result.map(async (prompt) => {
    //       const creator = await userCollection.findOne(
    //         { _id: new ObjectId(prompt.creatorsId) },
    //         { projection: { name: 1, email: 1, plan: 1 } },
    //       );
    //       return { ...prompt, creator };
    //     }),
    //   );

    //   res.send(promptsWithCreator);
    // });

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
            ...(status === "rejected"
              ? { rejectionDate: new Date() }
              : { approvedDate: new Date() }),
          },
        },
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({ error: "Prompt not found" });
      }

      const updatedPrompt = await promptCollection.findOne({
        _id: new ObjectId(id),
      });
      res.json({
        message: `Prompt ${status} successfully`,
        prompt: updatedPrompt,
      });
    });

    app.get("/api/admin/stats", async (req, res) => {
      const total = await promptCollection.countDocuments();
      const pending = await promptCollection.countDocuments({
        status: "pending",
      });
      const approved = await promptCollection.countDocuments({
        status: "approved",
      });
      const rejected = await promptCollection.countDocuments({
        status: "rejected",
      });

      const freeUsers = await userCollection
        .find({ plan: { $ne: "premium" } })
        .toArray();
      let usersAtLimit = 0;

      for (const user of freeUsers) {
        const count = await promptCollection.countDocuments({
          creatorsId: user._id.toString(),
        });
        if (count >= 3) usersAtLimit++;
      }

      res.json({
        total,
        pending,
        approved,
        rejected,
        usersAtLimit,
      });
    });

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
        updateData.rejectionReason =
          rejectionReason || "Did not meet platform guidelines";
      }

      const result = await promptCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData },
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({ error: "Prompt not found" });
      }

      const updatedPrompt = await promptCollection.findOne({
        _id: new ObjectId(id),
      });

      // Also update user's prompt count if approved
      if (status === "approved") {
        // User already has the prompt in their list, no need to update count
        // But we can log or notify
        console.log(
          `Prompt ${prompt.title} approved for user ${prompt.creatorsId}`,
        );
      }

      res.json({
        message: `Prompt ${status} successfully`,
        prompt: updatedPrompt,
      });
    });

    // 2. Get pending prompts count for admin
    app.get("/api/admin/pending-count", async (req, res) => {
      const pendingCount = await promptCollection.countDocuments({
        status: "pending",
      });
      res.json({ pendingCount });
    });

    // new admin apis

    // 1. Delete prompt (admin)
    app.delete("/api/admin/prompts/:id", async (req, res) => {
      const id = req.params.id;

      try {
        // First get the prompt to notify user
        const prompt = await promptCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!prompt) {
          return res.status(404).json({ error: "Prompt not found" });
        }

        const result = await promptCollection.deleteOne({
          _id: new ObjectId(id),
        });

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
          deletedId: id,
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
            updatedAt: new Date(),
          },
        },
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({ error: "Prompt not found" });
      }

      const updatedPrompt = await promptCollection.findOne({
        _id: new ObjectId(id),
      });

      if (featured) {
        await sendNotification(prompt.creatorsId, {
          type: "featured",
          message: `⭐ Your prompt "${prompt.title}" has been featured!`,
          promptId: id,
          title: prompt.title,
        });
      }
      res.json({
        message: featured
          ? "Prompt featured successfully"
          : "Prompt unfeatured successfully",
        prompt: updatedPrompt,
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
        createdAt: new Date(),
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
        { $set: { read: true } },
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
        updateData.rejectionReason =
          rejectionReason || "Did not meet platform guidelines";
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
        { $set: updateData },
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({ error: "Prompt not found" });
      }

      const updatedPrompt = await promptCollection.findOne({
        _id: new ObjectId(id),
      });
      res.json({
        message: `Prompt ${status} successfully`,
        prompt: updatedPrompt,
      });
    });

    // user managemnet api

    // Get all users with their prompt counts
    app.get("/api/admin/users",verifyToken,verifyRole("admin"), async (req, res) => {
      try {
        const users = await userCollection.find().toArray();

        // Get prompt count for each user
        const usersWithStats = await Promise.all(
          users.map(async (user) => {
            const promptCount = await promptCollection.countDocuments({
              creatorsId: user._id.toString(),
            });

            const approvedCount = await promptCollection.countDocuments({
              creatorsId: user._id.toString(),
              status: "approved",
            });

            const pendingCount = await promptCollection.countDocuments({
              creatorsId: user._id.toString(),
              status: "pending",
            });

            return {
              ...user,
              promptCount,
              approvedCount,
              pendingCount,
              _id: user._id.toString(),
            };
          }),
        );

        res.send(usersWithStats);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
      }
    });

    // Update user role
    app.patch("/api/admin/users/:userId/role",verifyToken,verifyRole("admin"), async (req, res) => {
      const userId = req.params.userId;
      const { role } = req.body;

      if (!["user", "creator", "admin"].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }

      const result = await userCollection.updateOne(
        { _id: new ObjectId(userId) },
        {
          $set: {
            role: role,
            updatedAt: new Date(),
          },
        },
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const updatedUser = await userCollection.findOne({
        _id: new ObjectId(userId),
      });
      res.json({
        message: `User role updated to ${role}`,
        user: updatedUser,
      });
    });

    // Delete user
    app.delete("/api/admin/users/:userId",verifyToken,verifyRole("admin"), async (req, res) => {
      const userId = req.params.userId;

      try {
        const user = await userCollection.findOne({
          _id: new ObjectId(userId),
        });
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        await promptCollection.deleteMany({ creatorsId: userId });

        await bookmarkCollection.deleteMany({ userId: userId });

        await reportCollection.deleteMany({ creatorId: userId });

        const result = await userCollection.deleteOne({
          _id: new ObjectId(userId),
        });

        res.json({
          message: `User ${user.email} deleted successfully`,
          deletedId: userId,
        });
      } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).json({ error: "Failed to delete user" });
      }
    });

    // Get user statistics
    app.get("/api/admin/users/stats",verifyToken,verifyRole("admin"), async (req, res) => {
      try {
        const totalUsers = await userCollection.countDocuments();
        const adminUsers = await userCollection.countDocuments({
          role: "admin",
        });
        const creatorUsers = await userCollection.countDocuments({
          role: "creator",
        });
        const regularUsers = await userCollection.countDocuments({
          role: "user",
        });

        const premiumUsers = await userCollection.countDocuments({
          plan: "premium",
        });
        const freeUsers = await userCollection.countDocuments({
          plan: { $ne: "premium" },
        });

        res.json({
          totalUsers,
          adminUsers,
          creatorUsers,
          regularUsers,
          premiumUsers,
          freeUsers,
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
      }
    });

    // payment management

    // Get all subscriptions with user details
    app.get("/api/admin/subscriptions",verifyToken,verifyRole("admin"), async (req, res) => {
      try {
        const subscriptions = await subscriptionCollection
          .find()
          .sort({ subscribedAt: -1 })
          .toArray();

        // Get user details for each subscription
        const subscriptionsWithUser = await Promise.all(
          subscriptions.map(async (sub) => {
            const user = await userCollection.findOne(
              { email: sub.email },
              { projection: { name: 1, email: 1, plan: 1, role: 1, _id: 1 } },
            );
            return {
              ...sub,
              _id: sub._id.toString(),
              user: user || { name: "Unknown", email: sub.email },
            };
          }),
        );

        res.send(subscriptionsWithUser);
      } catch (error) {
        console.error("Error fetching subscriptions:", error);
        res.status(500).json({ error: "Failed to fetch subscriptions" });
      }
    });

    // Get subscription statistics
    app.get("/api/admin/subscriptions/stats",verifyToken,verifyRole("admin"), async (req, res) => {
      try {
        const totalSubscriptions =
          await subscriptionCollection.countDocuments();
        const activeSubscriptions = await subscriptionCollection.countDocuments(
          {
            status: "active",
          },
        );
        const cancelledSubscriptions =
          await subscriptionCollection.countDocuments({
            status: "cancelled",
          });
        const expiredSubscriptions =
          await subscriptionCollection.countDocuments({
            status: "expired",
          });

        // Get unique users with premium plan
        const premiumUsers = await userCollection.countDocuments({
          plan: "premium",
        });

        // Get recent subscriptions (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const recentSubscriptions = await subscriptionCollection.countDocuments(
          {
            subscribedAt: { $gte: thirtyDaysAgo },
          },
        );

        // Get revenue stats (if you have amount field)
        // const totalRevenue = await subscriptionCollection.aggregate([
        //   { $group: { _id: null, total: { $sum: "$amount" } } }
        // ]).toArray();

        res.json({
          totalSubscriptions,
          activeSubscriptions,
          cancelledSubscriptions,
          expiredSubscriptions,
          premiumUsers,
          recentSubscriptions,
          // totalRevenue: totalRevenue[0]?.total || 0
        });
      } catch (error) {
        console.error("Error fetching subscription stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
      }
    });

    // Update subscription status
    app.patch("/api/admin/subscriptions/:id/status", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      if (!["active", "cancelled", "expired"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const result = await subscriptionCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status: status,
            updatedAt: new Date(),
          },
        },
      );

      if (result.modifiedCount === 0) {
        return res.status(404).json({ error: "Subscription not found" });
      }

      // If cancelled, update user plan
      if (status === "cancelled") {
        const subscription = await subscriptionCollection.findOne({
          _id: new ObjectId(id),
        });
        if (subscription) {
          await userCollection.updateOne(
            { email: subscription.email },
            { $set: { plan: "free_user" } },
          );
        }
      }

      const updatedSubscription = await subscriptionCollection.findOne({
        _id: new ObjectId(id),
      });
      res.json({
        message: `Subscription ${status} successfully`,
        subscription: updatedSubscription,
      });
    });

    //reports api

    // Get all reports with prompt and user details
    app.get("/api/admin/reports",verifyToken,verifyRole("admin"), async (req, res) => {
      try {
        const reports = await reportCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        // Get prompt and user details for each report
        const reportsWithDetails = await Promise.all(
          reports.map(async (report) => {
            // Get prompt details
            const prompt = await promptCollection.findOne(
              { _id: new ObjectId(report.promptId) },
              {
                projection: {
                  title: 1,
                  description: 1,
                  thumbnail: 1,
                  creatorsId: 1,
                  status: 1,
                },
              },
            );

            // Get creator details
            let creator = null;
            if (prompt?.creatorsId) {
              creator = await userCollection.findOne(
                { _id: new ObjectId(prompt.creatorsId) },
                { projection: { name: 1, email: 1 } },
              );
            }

            return {
              ...report,
              _id: report._id.toString(),
              prompt: prompt || null,
              creator: creator || null,
            };
          }),
        );

        res.send(reportsWithDetails);
      } catch (error) {
        console.error("Error fetching reports:", error);
        res.status(500).json({ error: "Failed to fetch reports" });
      }
    });

    // Remove prompt and all its reports
    app.delete("/api/admin/reports/:promptId/remove",verifyToken,verifyRole("admin"), async (req, res) => {
      const promptId = req.params.promptId;

      try {
        // Get prompt first
        const prompt = await promptCollection.findOne({
          _id: new ObjectId(promptId),
        });
        if (!prompt) {
          return res.status(404).json({ error: "Prompt not found" });
        }

        // Delete the prompt
        await promptCollection.deleteOne({ _id: new ObjectId(promptId) });

        // Delete all reports for this prompt
        await reportCollection.deleteMany({ promptId: promptId });

        // Send notification to creator
        await sendNotification(prompt.creatorsId, {
          type: "deleted",
          title: prompt.title,
          message: `Your prompt "${prompt.title}" has been removed due to multiple reports.`,
        });

        res.json({
          message: `Prompt "${prompt.title}" removed successfully`,
          promptId: promptId,
        });
      } catch (error) {
        console.error("Error removing prompt:", error);
        res.status(500).json({ error: "Failed to remove prompt" });
      }
    });

    // Warn creator
    app.patch("/api/admin/reports/:promptId/warn",verifyToken,verifyRole("admin"), async (req, res) => {
      const promptId = req.params.promptId;
      const { warningMessage } = req.body;

      try {
        const prompt = await promptCollection.findOne({
          _id: new ObjectId(promptId),
        });
        if (!prompt) {
          return res.status(404).json({ error: "Prompt not found" });
        }

        // Update prompt with warning
        await promptCollection.updateOne(
          { _id: new ObjectId(promptId) },
          {
            $set: {
              warned: true,
              warningMessage:
                warningMessage ||
                "Your prompt has been reported. Please review our guidelines.",
              warnedAt: new Date(),
              updatedAt: new Date(),
            },
          },
        );

        // Send warning notification to creator
        await sendNotification(prompt.creatorsId, {
          type: "warning",
          title: prompt.title,
          message: `Warning: Your prompt "${prompt.title}" has been reported.`,
          feedback: warningMessage || "Please review our community guidelines.",
        });

        res.json({
          message: `Warning sent to creator of "${prompt.title}"`,
          promptId: promptId,
        });
      } catch (error) {
        console.error("Error warning creator:", error);
        res.status(500).json({ error: "Failed to warn creator" });
      }
    });

    // Dismiss report (not harmful)
    app.patch("/api/admin/reports/:reportId/dismiss",verifyToken,verifyRole("admin"), async (req, res) => {
      const reportId = req.params.reportId;

      try {
        const report = await reportCollection.findOne({
          _id: new ObjectId(reportId),
        });
        if (!report) {
          return res.status(404).json({ error: "Report not found" });
        }

        // Update report status
        await reportCollection.updateOne(
          { _id: new ObjectId(reportId) },
          {
            $set: {
              status: "dismissed",
              dismissedAt: new Date(),
            },
          },
        );

        res.json({
          message: "Report dismissed successfully",
          reportId: reportId,
        });
      } catch (error) {
        console.error("Error dismissing report:", error);
        res.status(500).json({ error: "Failed to dismiss report" });
      }
    });

    // Get report statistics
    app.get("/api/admin/reports/stats",verifyToken,verifyRole("admin"), async (req, res) => {
      try {
        const totalReports = await reportCollection.countDocuments();
        const pendingReports = await reportCollection.countDocuments({
          status: { $ne: "dismissed" },
        });
        const dismissedReports = await reportCollection.countDocuments({
          status: "dismissed",
        });

        // Get unique prompts with reports
        const uniquePromptIds = await reportCollection.distinct("promptId");
        const uniquePrompts = uniquePromptIds.length;

        // Get reports by reason
        const reasons = await reportCollection
          .aggregate([
            { $group: { _id: "$reason", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ])
          .toArray();

        res.json({
          totalReports,
          pendingReports,
          dismissedReports,
          uniquePrompts,
          reasons: reasons.map((r) => ({ reason: r._id, count: r.count })),
        });
      } catch (error) {
        console.error("Error fetching report stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
      }
    });

    // analytics apis

    // Get all analytics data

    app.get("/api/admin/analytics",verifyToken,verifyRole("admin"), async (req, res) => {
      try {
        console.log("Fetching analytics data...");

        //Total Users
        const totalUsers = (await userCollection.countDocuments()) || 0;
        console.log(`Total Users: ${totalUsers}`);

        //Total Prompts
        const totalPrompts = (await promptCollection.countDocuments()) || 0;
        console.log(`Total Prompts: ${totalPrompts}`);

        //Prompt Status
        const approvedPrompts =
          (await promptCollection.countDocuments({ status: "approved" })) || 0;
        const pendingPrompts =
          (await promptCollection.countDocuments({ status: "pending" })) || 0;
        const rejectedPrompts =
          (await promptCollection.countDocuments({ status: "rejected" })) || 0;
        console.log(
          `Approved: ${approvedPrompts}, Pending: ${pendingPrompts}, Rejected: ${rejectedPrompts}`,
        );

        //Reviews, Copies, Bookmark, Rating
        let totalReviews = 0;
        let totalCopyCount = 0;
        let totalBookmarkCount = 0;
        let totalRatingSum = 0;
        let promptsWithRating = 0;

        const allPrompts = await promptCollection
          .find(
            {},
            {
              projection: {
                reviews: 1,
                copyCount: 1,
                bookmarkCount: 1,
                rating: 1,
              },
            },
          )
          .toArray();

        for (const prompt of allPrompts) {
          if (prompt.reviews && Array.isArray(prompt.reviews)) {
            totalReviews += prompt.reviews.length;
          }
          if (prompt.copyCount) {
            totalCopyCount += prompt.copyCount;
          }
          if (prompt.bookmarkCount) {
            totalBookmarkCount += prompt.bookmarkCount;
          }
          if (prompt.rating && prompt.rating > 0) {
            totalRatingSum += prompt.rating;
            promptsWithRating++;
          }
        }

        const averageRating =
          promptsWithRating > 0
            ? Math.round((totalRatingSum / promptsWithRating) * 10) / 10
            : 0;
        console.log(
          `Reviews: ${totalReviews}, Copies: ${totalCopyCount}, Avg Rating: ${averageRating}`,
        );

        //User Roles
        const adminUsers =
          (await userCollection.countDocuments({ role: "admin" })) || 0;
        const creatorUsers =
          (await userCollection.countDocuments({ role: "creator" })) || 0;
        const regularUsers =
          (await userCollection.countDocuments({ role: "user" })) || 0;
        const premiumUsers =
          (await userCollection.countDocuments({ plan: "premium" })) || 0;
        const freeUsers =
          (await userCollection.countDocuments({ plan: { $ne: "premium" } })) ||
          0;

        //Categories & AI Tools
        const categoriesResult = await promptCollection
          .aggregate([{ $group: { _id: "$category" } }, { $count: "total" }])
          .toArray();
        const totalCategories = categoriesResult[0]?.total || 0;

        const aiToolsResult = await promptCollection
          .aggregate([{ $group: { _id: "$aiTool" } }, { $count: "total" }])
          .toArray();
        const totalAITools = aiToolsResult[0]?.total || 0;

        //Active Users
        const activeUsersResult = await promptCollection
          .aggregate([{ $group: { _id: "$creatorsId" } }, { $count: "total" }])
          .toArray();
        const totalActiveUsers = activeUsersResult[0]?.total || 0;

        //Recent Activity (Last 7 Days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const newUsersLast7Days =
          (await userCollection.countDocuments({
            createdAt: { $gte: sevenDaysAgo },
          })) || 0;

        const newPromptsLast7Days =
          (await promptCollection.countDocuments({
            createdAt: { $gte: sevenDaysAgo },
          })) || 0;

        //New Reviews Last 7 Days
        const newReviewsResult = await promptCollection
          .aggregate([
            { $unwind: "$reviews" },
            { $match: { "reviews.createdAt": { $gte: sevenDaysAgo } } },
            { $count: "total" },
          ])
          .toArray();
        const newReviewsLast7Days = newReviewsResult[0]?.total || 0;

        //Response Data
        const responseData = {
          totalUsers: totalUsers || 0,
          totalPrompts: totalPrompts || 0,
          totalReviews: totalReviews || 0,
          totalCopyCount: totalCopyCount || 0,
          totalBookmarkCount: totalBookmarkCount || 0,
          averageRating: averageRating || 0,
          approvedPrompts: approvedPrompts || 0,
          pendingPrompts: pendingPrompts || 0,
          rejectedPrompts: rejectedPrompts || 0,
          premiumUsers: premiumUsers || 0,
          freeUsers: freeUsers || 0,
          adminUsers: adminUsers || 0,
          creatorUsers: creatorUsers || 0,
          regularUsers: regularUsers || 0,
          totalActiveUsers: totalActiveUsers || 0,
          totalCategories: totalCategories || 0,
          totalAITools: totalAITools || 0,
          newUsersLast7Days: newUsersLast7Days || 0,
          newPromptsLast7Days: newPromptsLast7Days || 0,
          newReviewsLast7Days: newReviewsLast7Days || 0,
          updatedAt: new Date(),
        };

        console.log("Analytics data fetched successfully!");
        res.json(responseData);
      } catch (error) {
        console.error("Analytics Error:", error);
        res.status(200).json({
          totalUsers: 0,
          totalPrompts: 0,
          totalReviews: 0,
          totalCopyCount: 0,
          totalBookmarkCount: 0,
          averageRating: 0,
          approvedPrompts: 0,
          pendingPrompts: 0,
          rejectedPrompts: 0,
          premiumUsers: 0,
          freeUsers: 0,
          adminUsers: 0,
          creatorUsers: 0,
          regularUsers: 0,
          totalActiveUsers: 0,
          totalCategories: 0,
          totalAITools: 0,
          newUsersLast7Days: 0,
          newPromptsLast7Days: 0,
          newReviewsLast7Days: 0,
          updatedAt: new Date(),
          error: error.message,
        });
      }
    });

    // Get analytics over time
    app.get("/api/admin/analytics/over-time",verifyToken,verifyRole("admin"), async (req, res) => {
      const { period = "weekly" } = req.query;

      try {
        let startDate = new Date();
        let groupFormat = {};

        switch (period) {
          case "daily":
            startDate.setDate(startDate.getDate() - 30);
            groupFormat = {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" },
            };
            break;
          case "monthly":
            startDate.setMonth(startDate.getMonth() - 12);
            groupFormat = {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
            };
            break;
          default: // weekly
            startDate.setDate(startDate.getDate() - 90);
            groupFormat = {
              year: { $year: "$createdAt" },
              week: { $week: "$createdAt" },
            };
            break;
        }

        // Users over time
        const usersOverTime = await userCollection
          .aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: { _id: groupFormat, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ])
          .toArray();

        // Prompts over time
        const promptsOverTime = await promptCollection
          .aggregate([
            { $match: { createdAt: { $gte: startDate } } },
            { $group: { _id: groupFormat, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ])
          .toArray();

        // Reviews over time
        const reviewsOverTime = await promptCollection
          .aggregate([
            { $unwind: "$reviews" },
            { $match: { "reviews.date": { $gte: startDate } } },
            { $group: { _id: groupFormat, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ])
          .toArray();

        // Copies over time
        const copiesOverTime = await promptCollection
          .aggregate([
            { $match: { updatedAt: { $gte: startDate } } },
            {
              $group: { _id: groupFormat, totalCopies: { $sum: "$copyCount" } },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray();

        res.json({
          period,
          startDate,
          usersOverTime,
          promptsOverTime,
          reviewsOverTime,
          copiesOverTime,
        });
      } catch (error) {
        console.error("Error fetching analytics over time:", error);
        res.status(500).json({ error: "Failed to fetch analytics over time" });
      }
    });

    // creator dashboard apis

    // Get creator stats
    app.get("/api/creator/stats/:creatorId", async (req, res) => {
      try {
        const creatorId = req.params.creatorId;

        // Get all prompts by this creator
        const prompts = await promptCollection
          .find({ creatorsId: creatorId })
          .toArray();

        // Total Prompts
        const totalPrompts = prompts.length;

        // Total Copies
        let totalCopies = 0;
        let totalBookmarks = 0;

        for (const prompt of prompts) {
          if (prompt.copyCount) totalCopies += prompt.copyCount;
          if (prompt.bookmarkCount) totalBookmarks += prompt.bookmarkCount;
        }

        // Get approved prompts count
        const approvedPrompts = prompts.filter(
          (p) => p.status === "approved",
        ).length;
        const pendingPrompts = prompts.filter(
          (p) => p.status === "pending",
        ).length;
        const rejectedPrompts = prompts.filter(
          (p) => p.status === "rejected",
        ).length;

        res.json({
          totalPrompts,
          totalCopies,
          totalBookmarks,
          approvedPrompts,
          pendingPrompts,
          rejectedPrompts,
          success: true,
        });
      } catch (error) {
        console.error("Error fetching creator stats:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch creator stats",
          totalPrompts: 0,
          totalCopies: 0,
          totalBookmarks: 0,
          approvedPrompts: 0,
          pendingPrompts: 0,
          rejectedPrompts: 0,
        });
      }
    });

    // Get creator chart data
    app.get("/api/creator/charts/:creatorId", async (req, res) => {
      try {
        const creatorId = req.params.creatorId;
        const { period = "weekly" } = req.query;

        // Get all prompts by this creator
        const prompts = await promptCollection
          .find({ creatorsId: creatorId })
          .toArray();

        // Get date range
        let days = 7;
        if (period === "weekly") days = 7;
        else if (period === "monthly") days = 30;
        else if (period === "yearly") days = 365;

        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Filter prompts by date
        const filteredPrompts = prompts.filter((p) => {
          const createdAt = new Date(p.createdAt);
          return createdAt >= startDate && createdAt <= endDate;
        });

        // Group by date for chart
        const dateMap = new Map();

        // Initialize all dates
        for (
          let d = new Date(startDate);
          d <= endDate;
          d.setDate(d.getDate() + 1)
        ) {
          const key = d.toISOString().split("T")[0];
          dateMap.set(key, { date: key, prompts: 0, copies: 0 });
        }

        // Fill data
        for (const prompt of filteredPrompts) {
          const key = new Date(prompt.createdAt).toISOString().split("T")[0];
          if (dateMap.has(key)) {
            const data = dateMap.get(key);
            data.prompts += 1;
            data.copies += prompt.copyCount || 0;
          }
        }

        // Convert to array and sort
        const chartData = Array.from(dateMap.values())
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((item) => ({
            name: new Date(item.date).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            }),
            prompts: item.prompts,
            copies: item.copies,
          }));

        // Get last 6 weeks for growth chart
        const growthData = [];
        const weeks = 6;
        const now = new Date();

        for (let i = weeks - 1; i >= 0; i--) {
          const weekStart = new Date(now);
          weekStart.setDate(weekStart.getDate() - (i * 7 + 7));
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6);

          const weekPrompts = prompts.filter((p) => {
            const createdAt = new Date(p.createdAt);
            return createdAt >= weekStart && createdAt <= weekEnd;
          });

          growthData.push({
            name: `Week ${weeks - i}`,
            prompts: weekPrompts.length,
          });
        }

        res.json({
          success: true,
          copiesData: chartData.slice(-7), // Last 7 days
          growthData: growthData,
          period: period,
        });
      } catch (error) {
        console.error("Error fetching creator charts:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch creator charts",
          copiesData: [],
          growthData: [],
        });
      }
    });

    //top creators api

    app.get("/api/creators/top", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 4;

        const allUsers = await userCollection
          .find({
            role: { $in: ["user", "creator"] },
          })
          .toArray();

        if (allUsers.length === 0) {
          return res.json({
            success: true,
            creators: [],
            total: 0,
            message: "No users found",
          });
        }

        const usersWithStats = await Promise.all(
          allUsers.map(async (user) => {
            const approvedCount = await promptCollection.countDocuments({
              creatorsId: user._id.toString(),
              status: "approved",
            });

            const pendingCount = await promptCollection.countDocuments({
              creatorsId: user._id.toString(),
              status: "pending",
            });

            const totalPrompts = await promptCollection.countDocuments({
              creatorsId: user._id.toString(),
            });

            const totalCopies = await promptCollection
              .aggregate([
                {
                  $match: {
                    creatorsId: user._id.toString(),
                    status: "approved",
                  },
                },
                { $group: { _id: null, total: { $sum: "$copyCount" } } },
              ])
              .toArray();

            const totalBookmarks = await promptCollection
              .aggregate([
                {
                  $match: {
                    creatorsId: user._id.toString(),
                    status: "approved",
                  },
                },
                { $group: { _id: null, total: { $sum: "$bookmarkCount" } } },
              ])
              .toArray();

            return {
              _id: user._id.toString(),
              name: user.name || "Anonymous User",
              email: user.email,
              role: user.role || "user",
              approvedCount: approvedCount || 0,
              pendingCount: pendingCount || 0,
              totalPrompts: totalPrompts || 0,
              promptCount: totalPrompts || 0, // ✅ Frontend-এর জন্য যোগ করুন
              totalCopies: totalCopies[0]?.total || 0,
              totalBookmarks: totalBookmarks[0]?.total || 0,
              image: user.image || null,
              plan: user.plan || "free",
              createdAt: user.createdAt,
            };
          }),
        );

        // ✅ Filter: যাদের approvedCount > 0
        const topCreators = usersWithStats
          .filter((c) => c.approvedCount > 0)
          .sort((a, b) => b.approvedCount - a.approvedCount)
          .slice(0, limit);

        if (topCreators.length === 0) {
          const fallbackCreators = usersWithStats
            .filter((c) => c.totalPrompts > 0)
            .sort((a, b) => b.totalPrompts - a.totalPrompts)
            .slice(0, limit);

          return res.json({
            success: true,
            creators: fallbackCreators,
            total: fallbackCreators.length,
            fallback: true,
            message:
              "No approved prompts yet, showing creators with pending prompts",
          });
        }

        res.json({
          success: true,
          creators: topCreators,
          total: topCreators.length,
          fallback: false,
        });
      } catch (error) {
        console.error("Error fetching top creators:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch top creators",
          creators: [],
        });
      }
    });

    // customer review apis

    // Get all reviews with user details
    app.get("/api/reviews/all", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 4;

        // Get all prompts with reviews
        const promptsWithReviews = await promptCollection
          .find({
            "reviews.0": { $exists: true },
          })
          .project({
            title: 1,
            reviews: 1,
            creatorsId: 1,
          })
          .toArray();

        // Extract all reviews with prompt and user info
        let allReviews = [];

        for (const prompt of promptsWithReviews) {
          // Get creator info
          const creator = await userCollection.findOne(
            { _id: new ObjectId(prompt.creatorsId) },
            { projection: { name: 1, email: 1, image: 1 } },
          );

          // Add prompt title and creator info to each review
          const reviewsWithInfo = prompt.reviews.map((review) => ({
            ...review,
            promptTitle: prompt.title,
            creatorName: creator?.name || "Unknown Creator",
            creatorImage: creator?.image || null,
            promptId: prompt._id,
          }));

          allReviews = [...allReviews, ...reviewsWithInfo];
        }

        // Sort by date (newest first) and limit
        allReviews.sort((a, b) => {
          const dateA = new Date(a.date || a.createdAt || 0);
          const dateB = new Date(b.date || b.createdAt || 0);
          return dateB - dateA;
        });

        // Get unique reviews (limit)
        const limitedReviews = allReviews.slice(0, limit);

        res.json({
          success: true,
          reviews: limitedReviews,
          total: allReviews.length,
        });
      } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).json({
          success: false,
          error: "Failed to fetch reviews",
          reviews: [],
        });
      }
    });

    // Get review statistics
    app.get("/api/reviews/stats", async (req, res) => {
      try {
        const totalReviews = await promptCollection
          .aggregate([
            {
              $project: {
                reviewCount: { $size: { $ifNull: ["$reviews", []] } },
              },
            },
            { $group: { _id: null, total: { $sum: "$reviewCount" } } },
          ])
          .toArray();

        const avgRating = await promptCollection
          .aggregate([
            { $match: { "reviews.0": { $exists: true } } },
            { $unwind: "$reviews" },
            { $group: { _id: null, avg: { $avg: "$reviews.rating" } } },
          ])
          .toArray();

        const ratingDistribution = await promptCollection
          .aggregate([
            { $match: { "reviews.0": { $exists: true } } },
            { $unwind: "$reviews" },
            { $group: { _id: "$reviews.rating", count: { $sum: 1 } } },
            { $sort: { _id: -1 } },
          ])
          .toArray();

        res.json({
          success: true,
          totalReviews: totalReviews[0]?.total || 0,
          averageRating: avgRating[0]?.avg || 0,
          ratingDistribution: ratingDistribution.map((r) => ({
            rating: r._id,
            count: r.count,
          })),
        });
      } catch (error) {
        console.error("Error fetching review stats:", error);
        res
          .status(500)
          .json({ success: false, error: "Failed to fetch review stats" });
      }
    });

    //pagination api

    app.get("/api/prompts", async (req, res) => {
      const {
        search,
        category,
        aiTool,
        difficulty,
        sort,
        page = 1,
        limit = 12,
      } = req.query;

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

      //Pagination calculation
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 12;
      const skip = (pageNum - 1) * limitNum;

      //Get total count for pagination
      const totalPrompts = await promptCollection.countDocuments(query);
      const totalPages = Math.ceil(totalPrompts / limitNum);

      //Get paginated results
      const result = await promptCollection
        .find(query)
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .toArray();

      res.send({
        prompts: result,
        pagination: {
          currentPage: pageNum,
          totalPages: totalPages,
          totalItems: totalPrompts,
          itemsPerPage: limitNum,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
        },
      });
    });

    app.get("/api/admin/prompts",verifyToken, verifyRole("admin"), async (req, res) => {
      const { status, page = 1, limit = 10 } = req.query;
      const query = {};

      if (status && status !== "all") {
        query.status = status;
      }

      // Pagination calculation
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 10;
      const skip = (pageNum - 1) * limitNum;

      // Get total count for pagination
      const totalPrompts = await promptCollection.countDocuments(query);
      const totalPages = Math.ceil(totalPrompts / limitNum);

      // Get paginated results
      const result = await promptCollection
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .toArray();

      // Get creator info for each prompt
      const promptsWithCreator = await Promise.all(
        result.map(async (prompt) => {
          const creator = await userCollection.findOne(
            { _id: new ObjectId(prompt.creatorsId) },
            { projection: { name: 1, email: 1, plan: 1 } },
          );
          return { ...prompt, creator };
        }),
      );

      res.send({
        prompts: promptsWithCreator,
        pagination: {
          currentPage: pageNum,
          totalPages: totalPages,
          totalItems: totalPrompts,
          itemsPerPage: limitNum,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
        },
      });
    });



















    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
//   } finally {
//     // await client.close();
//   }
// }
// run().catch(console.dir);

app.listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});

module.exports = app;
