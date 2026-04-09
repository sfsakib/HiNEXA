console.log("server file started");

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = "secret_key";

// MIDDLEWARE
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// DB CONNECT
mongoose.connect("mongodb://127.0.0.1:27017/hignice_clone")
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// ================= MODELS =================

// USER
const userSchema = new mongoose.Schema({
  phone: { type: String, unique: true },
  password: String,
  balance: { type: Number, default: 0 },
  referBalance: { type: Number, default: 0 },

  referralCode: String,
  referredBy: String,
  referrals: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

  role: { type: String, default: "user" },
  lastLogin: Date,
  name: String,

  avatar: { type: String, default: "" }, // ✅ ADD THIS
  notification: { type: String, default: "" }
});

const User = mongoose.model("User", userSchema);

// TRANSACTION
const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: String, // deposit / withdraw / referral
  amount: Number,
  method: String,
  trxId: String,
  note: String,
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now }
});

const Transaction = mongoose.model("Transaction", transactionSchema);

// ================= HELPERS =================

function randomName() {
  const names = ["MemPJG", "Agn", "Arlam", "Afnsu", "Mem0AK", "MemNC8"];
  return names[Math.floor(Math.random() * names.length)] + Math.floor(Math.random() * 1000);
}

function generateReferralCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ================= AUTH =================

// REGISTER
app.post("/api/register", async (req, res) => {
  try {
    const { phone, password, referralCode } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ message: "Phone and password required" });
    }

    const exist = await User.findOne({ phone });
    if (exist) {
      return res.status(400).json({ message: "User exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    let finalReferralCode = generateReferralCode();

    // code unique রাখা
    while (await User.findOne({ referralCode: finalReferralCode })) {
      finalReferralCode = generateReferralCode();
    }

    const user = new User({
      phone,
      password: hashed,
      name: randomName(),
      referralCode: finalReferralCode,
      referredBy: referralCode || null
    });

    await user.save();

    // referral connection save
    if (referralCode) {
      const refUser = await User.findOne({ referralCode });

      if (refUser) {
        refUser.referrals.push(user._id);
        await refUser.save();
      }
    }

    res.json({ message: "Registered" });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ message: "Error" });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { phone, password } = req.body;

    // ADMIN LOGIN
    if (phone === "01900000000" && password === "123456") {
      return res.json({
        user: {
          _id: "admin123",
          role: "admin",
          phone,
          name: "Admin"
        },
        token: "admin-token"
      });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

    // 🔥 BAN CHECK
    if(user.role === "banned"){
      return res.status(403).json({ message: "You are banned" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ message: "Wrong password" });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      { id: user._id, role: user.role },
      JWT_SECRET
    );

    res.json({ user, token });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Login error" });
  }
});

// ================= USER =================

// single user
app.get("/api/user/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 🔥 AUTO FIX referralCode
    if (!user.referralCode) {
      let code = Math.random().toString(36).substring(2, 8).toUpperCase();

      // ensure unique
      while (await User.findOne({ referralCode: code })) {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
      }

      user.referralCode = code;
      await user.save();
    }

    // password hide
    const userData = user.toObject();
    delete userData.password;

    res.json(userData);

  } catch (err) {
    console.error("GET USER ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// update name
app.post("/api/update-name", async (req, res) => {
  try {
    const { id, name } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.name = name;
    await user.save();

    res.json({ success: true });

  } catch (err) {
    console.error("UPDATE NAME ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ================= USER REQUEST =================

// DEPOSIT REQUEST
app.post("/api/deposit-request", async (req, res) => {
  try {
    const { userId, amount, method, trxId } = req.body;

    if (!userId || !amount || !trxId) {
      return res.status(400).json({ message: "Missing data" });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const trx = new Transaction({
      userId,
      type: "deposit",
      amount: Number(amount),
      method,
      trxId,
      status: "pending"
    });

    await trx.save();

    res.json({ message: "Deposit request sent" });

  } catch (err) {
    console.error("DEPOSIT REQUEST ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// WITHDRAW REQUEST
app.post("/api/withdraw-request", async (req, res) => {
  try {
    const { userId, amount, method, number, accountType, address } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ message: "Missing data" });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.balance < Number(amount)) {
      return res.status(400).json({ message: "Not enough balance" });
    }

    const trx = new Transaction({
      userId,
      type: "withdraw",
      amount: Number(amount),
      method,
      note: method === "wallet"
        ? `${accountType} - ${number}`
        : address,
      status: "pending"
    });

    await trx.save();

    res.json({ message: "Withdraw request sent" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// USERS
// ================= ADMIN =================

// GET ALL USERS
app.get("/api/admin/users", async (req, res) => {
  const users = await User.find().select("-password");
  res.json(users);
});


// 👇👇👇 এখান থেকে তোমার নতুন code শুরু

// UPDATE BALANCE
app.post("/api/admin/update-balance", async (req, res) => {
  try {
    const { userId, amount, type } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    if(type === "add"){
      user.balance += Number(amount);
    } else {
      user.balance -= Number(amount);
    }

    await user.save();
    res.json({ success: true });

  } catch(err){
    res.status(500).json({ message: "Error" });
  }
});


// BAN USER
app.post("/api/admin/ban", async (req, res) => {
  const { userId } = req.body;

  const user = await User.findById(userId);

  if(user.role === "banned"){
    user.role = "user"; // UNBAN
  } else {
    user.role = "banned"; // BAN
  }

  await user.save();

  res.json({ success: true, role: user.role });
});

// ALL TRANSACTIONS
app.get("/api/admin/transactions", async (req, res) => {
  try {

    const data = await Transaction.find()
      .populate("userId", "phone name referralCode referBalance balance")
      .sort({ createdAt: -1 });

    res.json(data);

  } catch (err) {
    console.error("ADMIN TRANSACTIONS ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// APPROVE
app.post("/api/admin/approve", async (req, res) => {
  try {
    const { id } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid transaction ID" });
    }

    const trx = await Transaction.findById(id);
    if (!trx) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    if (trx.status === "approved") {
      return res.status(400).json({ message: "Already approved" });
    }

    const user = await User.findById(trx.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (trx.type === "deposit") {
      user.balance += trx.amount;

      // referral bonus
      if (user.referredBy) {
        const refUser = await User.findOne({ referralCode: user.referredBy });

        if (refUser) {
          const bonus = trx.amount * 0.05;
          refUser.referBalance += bonus;
          await refUser.save();

          await Transaction.create({
            userId: refUser._id,
            type: "referral",
            amount: bonus,
            status: "approved",
            note: `Referral bonus from ${user.phone}`
          });
        }
      }

    } else if (trx.type === "withdraw") {
      user.balance -= trx.amount;
    }

    trx.status = "approved";

    await user.save();
    await trx.save();

    res.json({ message: "Approved" });

  } catch (err) {
    console.error("APPROVE ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// REJECT
app.post("/api/admin/reject", async (req, res) => {
  try {
    const { id } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid transaction ID" });
    }

    await Transaction.findByIdAndUpdate(id, { status: "rejected" });

    res.json({ message: "Rejected" });

  } catch (err) {
    console.error("REJECT ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ================= STATS =================

app.get("/api/admin/stats", async (req, res) => {
  try {
    const users = await User.find();
    const transactions = await Transaction.find();

    const totalUsers = users.length;

    const activeUsers = users.filter(u => u.lastLogin != null).length;

    // 🔥 ADD THIS
    const bannedUsers = users.filter(u => u.role === "banned").length;

    const deposits = transactions.filter(
      t => t.type === "deposit" && t.status === "approved"
    );

    const withdraws = transactions.filter(
      t => t.type === "withdraw" && t.status === "approved"
    );

    const totalDeposited = deposits.reduce((a, b) => a + b.amount, 0);
    const totalWithdrawn = withdraws.reduce((a, b) => a + b.amount, 0);

    const pendingDeposits = transactions.filter(
      t => t.type === "deposit" && t.status === "pending"
    ).length;

    const pendingWithdrawals = transactions.filter(
      t => t.type === "withdraw" && t.status === "pending"
    ).length;

    const rejectedDeposits = transactions.filter(
      t => t.type === "deposit" && t.status === "rejected"
    ).length;

    const rejectedWithdrawals = transactions.filter(
      t => t.type === "withdraw" && t.status === "rejected"
    ).length;

    res.json({
      totalUsers,
      activeUsers,
      bannedUsers, // ✅ ADD THIS

      totalDeposited,
      totalWithdrawn,

      pendingDeposits,
      pendingWithdrawals,
      rejectedDeposits,
      rejectedWithdrawals,

      totalPlayed: totalDeposited * 1.2,
      totalWin: totalDeposited * 0.8,
      totalLoss: totalDeposited * 0.4,
      totalProfit: totalDeposited * 0.4,

      deposituser: users.filter(u => u.balance > 0).length,
      nondeposituser: users.filter(u => u.balance === 0).length
    });

  } catch (err) {
    console.error("STATS ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ================= WALLET =================

app.get("/api/wallet/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const deposits = await Transaction.find({
      userId,
      type: "deposit",
      status: "approved"
    });

    const withdraws = await Transaction.find({
      userId,
      type: "withdraw",
      status: "approved"
    });

    const totalDeposit = deposits.reduce((sum, d) => sum + d.amount, 0);
    const totalWithdraw = withdraws.reduce((sum, w) => sum + w.amount, 0);

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      balance: user.balance,
      totalDeposit,
      totalWithdraw,
      mainWallet: user.balance,
      thirdWallet: user.referBalance || 0
    });

  } catch (err) {
    console.error("WALLET ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ================= REFERRAL =================

app.get("/api/referral/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const user = await User.findById(userId).populate("referrals", "phone name");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const history = await Transaction.find({
      userId,
      type: "referral"
    }).sort({ createdAt: -1 });

    res.json({
      code: user.referralCode,
      totalReferrals: user.referrals.length,
      referrals: user.referrals,
      earnings: user.referBalance,
      history
    });

  } catch (err) {
    console.error("REFERRAL ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ================= START =================

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});





// const path = require("path");

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "home.html"));
});



// USER TRANSACTION HISTORY
app.get("/api/user/history/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const data = await Transaction.find({ userId })
      .sort({ createdAt: -1 });

    res.json(data);

  } catch (err) {
    console.error("USER HISTORY ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});



// NOTIFICATION
app.post("/api/admin/notify", async (req, res) => {
  const { userId, message } = req.body;

  await User.findByIdAndUpdate(userId, {
    notification: message
  });

  res.json({ success: true });
});


// ACTIVE USERS
app.get("/api/admin/active-users", async (req, res) => {
  try {
    const users = await User.find({
      lastLogin: { $ne: null }
    }).select("-password");

    res.json(users);

  } catch(err){
    res.status(500).json({ message: "Error" });
  }
});


// BANNED USERS
app.get("/api/admin/banned-users", async (req, res) => {
  try {
    const users = await User.find({
      role: "banned"
    }).select("-password");

    res.json(users);

  } catch(err){
    res.status(500).json({ message: "Error" });
  }
});


// DEPOSIT USERS
app.get("/api/admin/deposit-users", async (req, res) => {
  try {
    const users = await User.find({
      balance: { $gt: 0 } // যাদের balance আছে
    }).select("-password");

    res.json(users);

  } catch(err){
    res.status(500).json({ message: "Error" });
  }
});

// NON DEPOSIT USERS
app.get("/api/admin/non-deposit-users", async (req, res) => {
  try {
    const users = await User.find({
      balance: 0 // যাদের balance নাই
    }).select("-password");

    res.json(users);

  } catch(err){
    res.status(500).json({ message: "Error" });
  }
});


// PENDING DEPOSITS
app.get("/api/admin/pending-deposits", async (req, res) => {
  try {
    const transactions = await Transaction.find({
      type: "deposit",
      status: "pending"
    }).populate("userId", "name phone balance");

    res.json(transactions);

  } catch(err){
    res.status(500).json({ message: "Error" });
  }
});

// APPROVE DEPOSIT
app.post("/api/admin/approve-deposit", async (req, res) => {
  const { id } = req.body;

  const deposit = await Transaction.findById(id);
  if(!deposit) return res.status(404).json({ message: "Not found" });

  deposit.status = "approved";
  await deposit.save();

  // balance add
  const user = await User.findById(deposit.userId);
  user.balance += deposit.amount;
  await user.save();

  res.json({ success: true });
});


// REJECT DEPOSIT
app.post("/api/admin/reject-deposit", async (req, res) => {
  const { id } = req.body;

  const deposit = await Transaction.findById(id);
  if(!deposit) return res.status(404).json({ message: "Not found" });

  deposit.status = "rejected";
  await deposit.save();

  res.json({ success: true });
});


// PENDING WITHDRAWALS
app.get("/api/admin/pending-withdrawals", async (req, res) => {
  try {
    const data = await Transaction.find({
      type: "withdraw",
      status: "pending"
    }).populate("userId", "name phone balance");

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
});

// APPROVE WITHDRAW
app.post("/api/admin/approve-withdraw", async (req, res) => {
  const { id } = req.body;

  const withdraw = await Transaction.findById(id);
  if (!withdraw) return res.status(404).json({ message: "Not found" });

  withdraw.status = "approved";
  await withdraw.save();

  // 🔥 BALANCE MINUS
  const user = await User.findById(withdraw.userId);
  user.balance -= withdraw.amount;
  await user.save();

  res.json({ success: true });
});


// REJECT WITHDRAW
app.post("/api/admin/reject-withdraw", async (req, res) => {
  const { id } = req.body;

  const withdraw = await Transaction.findById(id);
  if (!withdraw) return res.status(404).json({ message: "Not found" });

  withdraw.status = "rejected";
  await withdraw.save();

  res.json({ success: true });
});

// REJECTED DEPOSITS
app.get("/api/admin/rejected-deposits", async (req, res) => {
  try {
    const data = await Transaction.find({
      type: "deposit",
      status: "rejected"
    }).populate("userId", "name phone balance");

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
});

// REJECTED WITHDRAWALS
app.get("/api/admin/rejected-withdrawals", async (req, res) => {
  try {
    const data = await Transaction.find({
      type: "withdraw",
      status: "rejected"
    }).populate("userId", "name phone balance");

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
});


// TOTAL DEPOSIT HISTORY (APPROVED)
app.get("/api/admin/deposits", async (req, res) => {
  try {
    const data = await Transaction.find({
      type: "deposit",
      status: "approved"
    }).populate("userId", "name phone balance");

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
});



// TOTAL WITHDRAW HISTORY (APPROVED)
app.get("/api/admin/withdraws", async (req, res) => {
  try {
    const data = await Transaction.find({
      type: "withdraw",
      status: "approved"
    }).populate("userId", "name phone balance");

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
});

// ================= CHAT =================

const chatSchema = new mongoose.Schema({
  userId: String,
  sender: String, // admin / user
  message: String,
  image: String,
  createdAt: { type: Date, default: Date.now }
});

const Chat = mongoose.model("Chat", chatSchema);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

if (!fs.existsSync(path.join(__dirname, "uploads"))) {
  fs.mkdirSync(path.join(__dirname, "uploads"));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

app.get("/api/chat/:userId", async (req, res) => {
  const data = await Chat.find({ userId: req.params.userId }).sort({ createdAt: 1 });
  res.json(data);
});

app.post("/api/chat/send", async (req, res) => {
  const { userId, sender, message, image } = req.body;

  const msg = await Chat.create({
    userId,
    sender,
    message,
    image
  });

  res.json(msg);
});

app.post("/api/chat/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  res.json({
    image: "/uploads/" + req.file.filename
  });
});


// FEEDBACK
const feedbackSchema = new mongoose.Schema({
  userId: String,
  message: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Feedback = mongoose.model("Feedback", feedbackSchema);

// ================= FEEDBACK =================

// SUBMIT FEEDBACK
app.post("/api/feedback", async (req, res) => {
  try {
    const { userId, message } = req.body;

    if (!message) {
      return res.status(400).json({ message: "Message required" });
    }

    const fb = new Feedback({
      userId,
      message
    });

    await fb.save();

    res.json({ success: true });

  } catch (err) {
    console.error("FEEDBACK ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET ALL FEEDBACK (ADMIN)
app.get("/api/admin/feedback", async (req, res) => {
  try {
    const data = await Feedback.find().sort({ createdAt: -1 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "Error" });
  }
});


// CHANGE AVATAR
app.post("/api/user/avatar", async (req,res)=>{
  const {userId, avatar} = req.body;
  await User.findByIdAndUpdate(userId,{avatar});
  res.json({success:true});
});

// CHANGE PASSWORD
app.post("/api/user/password", async (req,res)=>{
  try{
    const {userId, oldPass, newPass} = req.body;

    const user = await User.findById(userId);
    if(!user) return res.json({success:false});

    // 🔥 compare hash password
    const match = await bcrypt.compare(oldPass, user.password);

    if(!match){
      return res.json({success:false});
    }

    // 🔥 hash new password
    const hashed = await bcrypt.hash(newPass, 10);
    user.password = hashed;

    await user.save();

    res.json({success:true});

  }catch(err){
    res.status(500).json({success:false});
  }
});
