const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
const express = require('express'),
      	helmet = require("helmet"),
	CSRFGuard = require("csrf-guard"),
	fs = require('fs'),
	fileUpload = require('express-fileupload'),
	util = require('util'),
	path = require("path"),
	redis = require('redis'),
	app = express(),
	http = require('http'),
	server = http.createServer(app),
	{ Server } = require("socket.io"),
	{ watchFile } = require('fs'),
	io = new Server(server, {
		//necessary to buffer files > 1mb
		maxHttpBufferSize: 1e8,
		credentials: true
		//transports: [ "websocket" ]
	}),
	mysql = require('mysql'),
	expHbs = require('express-handlebars'),
	bcrypt = require('bcrypt'),
	passport = require('passport'),
	localStrat = require('passport-local').Strategy,
	methodOverride = require('method-override'),
	flash = require("express-flash"),
	session = require("express-session");
	

	// App
const client = require('prom-client');
const collectDefaultMetrics = client.collectDefaultMetrics;
// Probe every 5th second.
collectDefaultMetrics({ timeout: 5000 });


const pubClient = createClient({ host: 'redis', port: 6379 });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));


const counter = new client.Counter({
  name: 'node_request_operations_total',
  help: 'The total number of processed requests'
});
counter.inc();

//auth functionality
function initPassport(passport) {
	const authUser = async (username, password, done) => {
		let sql = `SELECT userId, username, userPassword, profilePic FROM User WHERE username = ?;` // ? = username
		sqlCon.query(sql, [username], async (errUsername, sqlResUsername) => {
			if (errUsername) {
				console.log("ERROR: Error fulfilling SQL-query!\n" + errUsername);
			} else {
				const user = sqlResUsername[0];
				if (user === undefined) {
					return done(null, false, { message: "No user matching this username" })
				}
				try {
					if (await bcrypt.compare(password, user.userPassword)) {
						return done(null, user)
					} else {
						return done(null, false, { message: "Password incorrect" })
					}
				} catch (e) {
					return done(e)
				}
			}
		})
	}
	passport.use(new localStrat(authUser));
	passport.serializeUser((user, done) => done(null, user.userId))
	passport.deserializeUser((id, done) => {
		let sql = `SELECT userId, username, userPassword, profilePic FROM User WHERE userId = ?`; // ? = Id
		sqlCon.query(sql, [id], async (errId, sqlResId) => {
			if (errId) {
				console.log("ERROR: Error fulfilling SQL-query!\n" + errId);
				return null;
			} else {
				return done(null, sqlResId[0])
			}
		})
	})
}

//----------setup middleware-------------------------

initPassport(passport);

//setting static folder to "/public"
app.use(express.static(path.join(__dirname, "/public")));
app.use(flash());
app.use(fileUpload());
//secret should be changed once in a while
const sessionMw = session({
	secret: "7Hfh&$§hfg/jds%$3jF8jkgFG74j(FGj48=FKG/",
	resave: false,
	saveUninitialized: false
})
app.use(sessionMw);
app.use(passport.initialize());
app.use(passport.session());
app.use(methodOverride("_method"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// Exercise 5 
app.use(new CSRFGuard({ secret: "csrf-key" }));
app.disable("x-powered-by");
app.use(helmet());
const hbs = expHbs.create({
	extname: "hbs",
	layoutsDir: `${__dirname}/views/layouts`,
	partialsDir: __dirname + "/views/partials"
});
app.engine("handlebars", hbs.engine);
app.set("view engine", "handlebars");

// convert a connect middleware to a Socket.IO middleware COPIED FROM socketio EXAMPLE
const wrap = middleware => (socket, next) => middleware(socket.request, {}, next);
io.use(wrap(sessionMw));
io.use(wrap(passport.initialize()));
io.use(wrap(passport.session()));



function checkAuth(req, res, next) {
	if (req.isAuthenticated()) {
		return next()
	}
	res.redirect("/login")
}

function checkNotAuth(req, res, next) {
	if (req.isAuthenticated()) {
		return res.redirect("/chatroom")
	}
	next()
}

//----------/setup middleware------------------------

//----------user functions---------------------------
const users = [];

//returns user obj with matching id
function getUser(id) {
	return users.find((user) => user.id === id);
}

//removes user leaving chat
function removeUser(id) {
	var index = users.findIndex((user) => user.id === id);
	if (index !== -1) {
		return users.splice(index, 1)[0];
	}
}

//returns a String containing online usernames
function getUserListString() {
	userList = "Users online: ";
	users.forEach((item) => {
		userList = userList + ` ${item.username},`;
	});
	return userList;
}

//returns a username list for the recipient selection
function getUsernamesList() {
	var usernames = [];
	for (let i = 0; i < users.length; i++) {
		usernames.push(users[i].username);
	}
	return usernames;
}

function getSocketId(usernames) {
	let socketId = [];
	for (let i = 0; i < usernames.length; i++) {
		for (let j = 0; j < users.length; j++) {
			if (users[j].username === usernames[i]) {
				socketId.push(users[j].id);
				break;
			}
		}
	}
	return socketId;
}
//---------/user functions---------------------------

//----------router-----------------------------------

app.get("/", checkNotAuth, (req, res) => {
	res.redirect("/login");
	console.log("server")
})

app.get("/login", checkNotAuth, async(req, res) => {
	const token = await req.getToken();
	res.render("empty", { layout: "login" });
})

app.get("/metrics", (req,res) => {
	res.send("metriken");
})

app.post("/login", checkNotAuth, passport.authenticate("local", {
	successRedirect: "/chatroom",
	failureRedirect: "/login",
	failureFlash: true
}));

app.get("/register", checkNotAuth, async(req, res) => {
	const token = await req.getToken();
	res.render("empty", { layout: "register" });
})

app.post("/register", checkNotAuth, async (req, res) => {
	try {
		var success = true;
		if (req.files) {
			var file = req.files.profilePic;
			var fileName = file.name;
			if (file.data.length > 5000000) throw "File too large. Max 5MB!";
			var fileExt = path.extname(fileName);
			var allowedExt = /png|jpeg|jpg|gif/;
			if (!allowedExt.test(fileExt)) throw "Unsupported File Type!";
			var fileURL = "/uploads/" + file.md5 + fileExt;
			await util.promisify(file.mv)("./public" + fileURL);
		}
	} catch (err) {
		success = false;
		console.log(err);
		res.render("empty", { layout: "register", errMsg: "File too large or unsupported type!" });
	}
	if (success) {
		try {
			sqlCon.query("SELECT username FROM User WHERE username = ?;", [req.body.username], async (sqlErr, sqlRes) => {
				if (sqlErr) {
					console.log("ERROR: Error checking if username is taken!");
					throw sqlErr;
				} else {
					console.log(sqlRes)
					if (sqlRes[0] === undefined) {
						var hashPw = await bcrypt.hash(req.body.password, 10);
						let sql = `INSERT INTO User VALUES (default,?,?,?);`
						sqlCon.query(sql, [req.body.username, hashPw, fileURL], async (sqlErr, sqlResRegister) => {
							if (sqlErr) {
								console.log("ERROR: Error inserting User!\n" + sqlErr);
								throw sqlErr;
							} else {
								console.log("User inserted")
								res.redirect("/login");
							}
						})
					} else {
						res.render("empty", { layout: "register", errMsg: "Username taken!" });
					}
				}
			});
		} catch (sqlErr) {
			console.log(sqlErr)
			res.redirect("/register");
		}
	}
})

app.get("/chatroom", checkAuth, (req, res) => {
	let sql = `SELECT msg, msgDate FROM Message WHERE msgSender = ? OR msgRecipient = ?;`
	let param = req.user.userId;
	sqlCon.query(sql, [param, param], (sqlErr, sqlRes) => {
		if (sqlErr) {
			console.log("Failed to get messages! " + sqlErr);
			res.redirect("/login");
		} else {
			console.log("Successfully retrieved messages! ");
			res.render("chatData", { layout: "chatroom", messages: sqlRes });
		}
	})
});

//---------/router-----------------------------------

//event handling
io.on('connection', (socket) => {

	//handle sign in event
	socket.on("userSignin", () => {
		socketUsername = socket.request.user.username;
		if (getUsernamesList().includes(socketUsername)) {
			socket.request.session.destroy();
			socket.emit('redirect', "/login");
		} else {
			//save socketId in session.id COPIED FROM socketio EXAMPLE -- Needed?
			const session = socket.request.session;
			session.socketId = socket.id;
			session.save();
			users.push({ id: socket.id, username: socketUsername, userId: socket.request.user.userId, profilePic: socket.request.user.profilePic });
			socket.join();
			msg = new Date().toLocaleTimeString() + ` | ${socketUsername} has joined the chat.`;
			io.emit('serverMessage', msg, type = "user-join", null, null, socket.request.user.profilePic);
			socket.emit('ownUsername', socketUsername)
			const userList = getUserListString();
			const usernames = getUsernamesList();
			io.emit('userList', userList, usernames);
			console.log(`${socketUsername} joined`)
		}
	});

	socket.on("chat message", async (msg, rec, media, mediaType) => {
		const user = getUser(socket.id);
		let recipients = getSocketId(rec);
		//if statement prevents crashes from open tabs opened before restart
		if (user) {
			
			profilePic = socket.request.user.profilePic;
			//var profilePic = await fs.readFileSync(__dirname + "/public" + profilePicPath, {encoding: 'base64'});
			nowTime = new Date().toLocaleTimeString();
			dateTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
			if (recipients.length > 0) {
				msg = ` | ${user.username} to ${rec}: ${msg}`;
				for (let i = 0; i < recipients.length; i++) {
					let sql = `INSERT INTO Message (msgId, msgSender, msgRecipient, msgDate, msg) VALUES (default, ${socket.request.user.userId}, ${getUser(recipients[i]).userId}, '${dateTime}', ?);`
					sqlCon.query(sql, [msg], (sqlErr, sqlRes) => {
						if (sqlErr) {
							console.log("Failed to insert message! " + sqlErr);
						} else {
							console.log("Successfully inserted message! " + JSON.stringify(sqlRes));
						}
					})
					msg = nowTime + msg;
					io.to(recipients[i]).emit("serverMessage", msg, type = "private-chat", media, mediaType, profilePic);
					console.log(`Private message to ${rec}: ` + msg);
				}
				socket.emit("serverMessage", msg, type = "private-chat", media, mediaType, profilePic);
			}
			else {
				msg = nowTime + ` | ${user.username}: ${msg}`;
				io.emit("serverMessage", msg, type = "chat", media, mediaType, profilePic);
				console.log("User message: " + msg);
			}
		}
	});

	//handle disconnect event
	socket.on("disconnect", () => {
		const user = getUser(socket.id);
		//if statement prevents crashes from open tabs opened before restart
		if (user) {
			msg = new Date().toLocaleTimeString() + ` | ${user.username} has left the chat.`;
			io.emit("serverMessage", msg, type = "user-leave", null, null, user.profilePic);
			console.log(`${user.username} disconnected`)
			removeUser(socket.id);
			socket.request.session.destroy();
			const userList = getUserListString();
			const usernames = getUsernamesList();
			io.emit('userList', userList, usernames);
		}
	});
});

//sql-connection
var sqlCon = mysql.createConnection({
	host: "localhost",
	host: "mysql",
	user: "root",
	password: "291293ek",
	database: "cc_ex2",
	dateStrings: "date",
	charset: 'utf8mb4',
	multipleStatements: true
});

//connect to mysql db
sqlCon.connect((err) => {
	if (err) {
		console.log("ERROR: Connection to Database failed!\n");
		throw err;
	}
	else {
		console.log("Connection to Database established!\n");
	}
});
app.get('/', function(req, res) {
    redisClient.get('numVisits', function(err, numVisits) {
        numVisitsToDisplay = parseInt(numVisits) + 1;
        if (isNaN(numVisitsToDisplay)) {
            numVisitsToDisplay = 1;
        }
        res.send('web1: Total number of visits is: ' + numVisitsToDisplay);
        numVisits++;
        redisClient.set('numVisits', numVisits);
    });
});
//start server
server.listen(3000, () => {
	console.log('listening on *:3000');
});
