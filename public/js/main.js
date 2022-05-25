var socket = io();

//automatic reconnects for more resiliency
io.connect({
	'reconnection': true,
	'reconnectionDelay': 500,
	'reconnectionAttempts': 10
});

//When user signs in, emit event
socket.emit("userSignin");

var messages = document.getElementById("messages");
var form = document.getElementById("form");
var msgInput = document.getElementById("msgInput");
var fileInput = document.getElementById("fileInput");
var sendButton = document.getElementById("sendButton");
var media = "";
var mediaType = "";
var ownUsername = "";

async function appendMessage(item, mediaItem, profilePic) {
	if (mediaItem) {
		br = document.createElement("br");
		item.appendChild(br)
		item.appendChild(mediaItem)
	};
	await messages.appendChild(item);
	window.scrollTo({ left: 0, top: document.body.scrollHeight, behavior: "smooth" });

}

function iterationList(options) {
	let tempArray = [];

	for (let i = 0; i < options.length; i++) {
		tempArray[i] = options[i].value;

	}
	return (tempArray);
}

fileInput.onchange = () => {
	if (fileInput.files[0].size > 5000000) {
		alert("File is too big! Max: 5MB!");
		fileInput.value = "";
	}
}

form.addEventListener("submit", (e) => {
	e.preventDefault();     //prevent page reload
	if (msgInput.value || media !== "") {
		let selectedRecipients = document.querySelectorAll("option:checked")
		let recipients = iterationList(selectedRecipients)
		socket.emit("chat message", msgInput.value, recipients, media, mediaType);
		msgInput.value = "";
		media = "";
		mediaType = "";
	}
});

fileInput.addEventListener("change", (e) => {
	mediaType = fileInput.files[0].type;
	var reader = new FileReader();
	reader.onload = () => {
		media = reader.result;
	}
	reader.readAsDataURL(fileInput.files[0])

}, false);


socket.on("serverMessage", (msg, type, serverMedia, serverMediaType, profilePic, articleLink, articleLabel) => {
	var item = document.createElement("li");
	//profile pic
	var profilePicImg = document.createElement("img");
	if (profilePic) {
		profilePicImg.src = "http://127.0.0.1:3000/" + profilePic;
	} else {
		profilePicImg.src = "http://127.0.0.1:3000/uploads/defaultProfilePic.png"
	}
	profilePicImg.classList.add("profilePic");
	item.appendChild(profilePicImg);
	//msg
	let msgP = document.createElement("p");
	msgP.innerHTML = msg;
	item.appendChild(msgP)
	//article link
	if(articleLink){
		item.appendChild(document.createElement("br"))
		let a = document.createElement("a");
		a.href = articleLink;
		a.innerHTML = `Wiki Article of ${articleLabel}`;
		a.classList.add("articleLink");
		console.log(a)
		item.appendChild(a);
	}
	//media
	var mediaItem = "";
	if (serverMedia) {
		if (serverMediaType === "image/png" || serverMediaType === "image/jpeg" || serverMediaType === "image/jpg" || serverMediaType === "image/gif") {
			mediaItem = document.createElement("img");
			mediaItem.classList.add("mediaPic");
		}
		if (serverMediaType === "video/mp4" || serverMediaType === "video/webm") {
			mediaItem = document.createElement("video");
			mediaItem.classList.add("mediaVid")
			mediaItem.controls = true;
		}
		if (serverMediaType === "audio/wav" || serverMediaType === "audio/mp3" || serverMediaType === "audio/mpeg") {
			mediaItem = document.createElement("audio");
			mediaItem.controls = true;
		}
		mediaItem.src = serverMedia;
	}
	//message type
	switch (type) {
		case "user-join":
			item.classList.add("user-join");
			break;
		case "user-leave":
			item.classList.add("user-leave");
			break;
		case "private-chat":
			item.classList.add("private-message");
			break;
		default:
			break;
	}
	appendMessage(item, mediaItem, profilePic);
});

socket.on("userList", (users, usernames) => {
	document.getElementById("onlineUsers").innerHTML = users;
	document.getElementById("recSelect").innerHTML = `<option value="" selected>Everyone</option>`;
	if (usernames.length > 1) {
		for (let i = 0; i < usernames.length; i++) {
			if (usernames[i] !== ownUsername) {
				let newOption = document.createElement("option");
				newOption.value = usernames[i];
				newOption.text = usernames[i];
				let select = document.getElementById("recSelect")
				select.appendChild(newOption);
			}
		}
	}
});

socket.on('ownUsername', (username) => {
	ownUsername = username;
})

socket.on('redirect', (destination) => {
	window.location.href = destination;
});
