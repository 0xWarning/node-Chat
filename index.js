const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');


// MongoDB configuration
const mongoDBUrl = 'mongodb+srv://Test:Qk9rthwZlrZeENY6@cluster0.9yliv.mongodb.net'; // Replace with your MongoDB URL
mongoose.connect(mongoDBUrl, { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => console.log('Connected to MongoDB'));

const activeUsers = new Set(); // Store active users in a Set

// User schema and model
const userSchema = new mongoose.Schema({
  username: String,
  password: String
});

userSchema.plugin(require('passport-local-mongoose'));
const User = mongoose.model('User', userSchema);
userSchema.index({ username: 1 });

// Define the schema for chat messages
const chatMessageSchema = new mongoose.Schema({
    username: String,
    msg: String,
    timestamp: Date,
  });
  
  // Create a model based on the schema
  const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

// Passport configuration
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

// Express session middleware with MongoDB session store
const sessionStore = MongoStore.create({
  mongoUrl: mongoDBUrl,
  mongooseConnection: mongoose.connection,
  collectionName: 'sessions' // Optional: Set a custom collection name for sessions
});

app.use(session({
  secret: 'fuckaduck123',
  resave: false,
  saveUninitialized: false,
  store: sessionStore
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(passport.initialize());
app.use(passport.session());
app.set('view engine', 'ejs');
app.use(express.static(__dirname + '/public'));
app.use('/style.css', express.static(__dirname + '/public/style.css'));

// Store connected users
const users = {};

// Check if a user is authenticated
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/public/login.html');
  });
  
app.post('/login', passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login'
  }), (req, res) => {
    req.login(req.user, (err) => {
      if (err) {
        console.error('Error creating session:', err);
        res.redirect('/login');
      } else {
        res.redirect('/');
      }
    });
  });
  
  app.get('/register', (req, res) => {
    res.sendFile(__dirname + '/public/register.html');
  });
  
  app.post('/register', async (req, res) => {
    try {
      const user = new User({ username: req.body.username });
      await User.register(user, req.body.password);
      passport.authenticate('local')(req, res, () => {
        res.redirect('/');
      });
    } catch (err) {
      console.error('Error registering user:', err);
      res.redirect('/register');
    }
  });
  
  app.get('/logout', (req, res) => {
    req.logout();
    res.redirect('/login');
  });

io.on('connection', (socket) => {
    console.log('A user connected');
    
    socket.on('join', (username) => {

    // Add the user to the active users Set
    activeUsers.add(username);
     // Emit the updated list of online users to all connected clients
    io.emit('online users', Array.from(activeUsers));
      // Store the username associated with the socket ID
      socket.username = username;
      users[socket.id] = username;
      socket.broadcast.emit('user joined', username);
      io.emit('users', Object.values(users));
    });
  
    // Handle new chat messages
    socket.on('chat message', async (data) => {
        const timestamp = new Date().toLocaleTimeString();
        const messageData = { username: data.username, msg: data.msg, timestamp };
        io.emit('chat message', messageData);
      
        try {
          // Save the chat message to the database using async/await
          const newChatMessage = new ChatMessage({
            username: data.username,
            msg: data.msg,
            timestamp: new Date(),
          });
          await newChatMessage.save();
        } catch (err) {
          console.error('Error saving chat message:', err);
        }
      });
  
    // Handle user disconnection
    socket.on('disconnect', () => {
      const username = users[socket.id];
      delete users[socket.id];
      socket.broadcast.emit('user left', username);
           // Remove the user from the active users Set
           activeUsers.delete(username);

           // Emit the updated list of online users to all connected clients
           io.emit('online users', Array.from(activeUsers));
      io.emit('users', Object.values(users));
      console.log('A user disconnected');
    });
  });

// Handle chat message submission using the '/chat' route
app.post('/chat', (req, res) => {
  const { username, msg, timestamp } = req.body; // Destructure the timestamp from the request body

  // Process the chat message (broadcast to other users, etc.)

  // Emit the chat message to all connected clients, including the timestamp
  io.emit('chat message', { username, msg, timestamp });

  res.sendStatus(200); // Respond with success status (optional)
});

// Endpoint to get the chat history and active users list
app.get('/chat/history', (req, res) => {
  const chatData = {
    //history: chatHistory,
    users: Array.from(activeUsers), // Convert Set to an array for easy serialization
  };
  res.json(chatData);
});

app.get('/', ensureAuthenticated, async (req, res) => {
    const username = req.user.username; // Get the username from the session (assuming it's stored there after login)
  
    try {
      // Retrieve chat history from the database using async/await
      const chatMessages = await ChatMessage.find({}).sort({ timestamp: 1 }).exec();
  
      const chatHistory = chatMessages.map((message) => {
        return { username: message.username, msg: message.msg, timestamp: message.timestamp.toLocaleTimeString() };
      });
  
      res.render('index', { username, chatHistory: JSON.stringify(chatHistory) }); // Pass chatHistory as JSON string
    } catch (err) {
      console.error('Error retrieving chat history:', err);
      res.render('index', { username, chatHistory: '[]' }); // Provide an empty array as chatHistory in case of an error
    }
    });
  
// Start the server
const port = process.env.PORT || 3000;
http.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
