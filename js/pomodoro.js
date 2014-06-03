DeviceDetector = {}
DeviceDetector.IsIOS = function () {
	return /(iPad|iPhone|iPod)/g.test( navigator.userAgent );
}
DeviceDetector.IsIOS2 = function () {
	return /(iPad|iPhone|iPod)/g.test( navigator.platform );
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

AudioManager = {}
AudioManager.Alarm = new Audio();
AudioManager.load = function () { 
	AudioManager.Alarm.src = "aud/alarm.mp3"; 
	AudioManager.Alarm.load();
}
AudioManager.play = function () { 
	AudioManager.Alarm.play();
}
if (!DeviceDetector.IsIOS()) AudioManager.load();

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

NotificationManager = {}
NotificationManager.requestNotificationPermission = function() {
	if ("Notification" in window) {
		Notification.requestPermission(function (permission) { 
			Notification.permission = permission; 
			console.log(permission);
		});
	}
}

NotificationManager.notifyUser = function(message) {
	if ("Notification" in window) {
		if (!("permission" in Notification) || (Notification.permission === "default")) 
		{
			NotificationManager.requestNotificationPermission();
		}
		
		if (Notification.permission !== "denied")
		{
			var notification = new Notification('Pomodoro do Arara', { body: message, icon: window.location + "images/icon-128.png" });
		}
	}
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

PomodoroEntry = function() { 
	this.Name = "";
	this.State = 0;
	this.Start = ko.observable(null);
	this.End = ko.observable(null);
	this.Parent = null;
	this.FormattedStart = ko.computed(function() { return !!this.Start() ? this.Start().format("MMM DD | HH:mm") : ""; }, this);
	this.FormattedEnd = ko.computed(function() { return !!this.End() ? this.End().format("MMM DD | HH:mm") : ""; }, this);
	this.Difference = ko.computed(function() { 
		if (!!this.Start() && !!this.End()) {
			var diff = this.End().diff(this.Start(), "seconds");
			return PomodoroManager.formatTimeDifference(diff);
		} else return "";
	}, this);
}

PomodoroEntry.Serialize = function(entry) {
	var a = {};
	a.Name = entry.Name;
	a.State = entry.State;
	a.Start = entry.Start().toJSON();
	a.End = entry.End().toJSON();
	return a;
}
PomodoroEntry.Deserialize = function(jsonObject, manager) {
	var a = new PomodoroEntry();
	a.Name = jsonObject.Name;
	a.State = jsonObject.State;
	a.Start(moment(jsonObject.Start));
	a.End(moment(jsonObject.End));
	a.Parent = manager;
	return a;
}

PomodoroSummaryEntry = function() {
	this.Name = "";
	this.WorkTime = ko.observable(0);
	this.BreakTime = ko.observable(0);
	this.PauseTime = ko.observable(0);
	
	this.FormattedWorkTime = ko.computed(function() { return PomodoroManager.formatTimeDifference(this.WorkTime()); }, this);
	this.FormattedBreakTime = ko.computed(function() { return PomodoroManager.formatTimeDifference(this.BreakTime()); }, this);
	this.FormattedPauseTime = ko.computed(function() { return PomodoroManager.formatTimeDifference(this.PauseTime()); }, this);
}
PomodoroSummaryEntry.prototype.addTime = function(seconds, state) {
	if (state == PomodoroManagerState.WORKING) {
		this.WorkTime(this.WorkTime() + seconds);
	} else if (state == PomodoroManagerState.SHORTBREAK || state == PomodoroManagerState.LONGBREAK) {
		this.BreakTime(this.BreakTime() + seconds);
	} else if (state == PomodoroManagerState.POTTYPAUSE) {
		this.PauseTime(this.PauseTime() + seconds);
	}
}

PomodoroManagerState = {}
PomodoroManagerState.IDLE = 0;
PomodoroManagerState.WORKING = 1;
PomodoroManagerState.SHORTBREAK = 2;
PomodoroManagerState.LONGBREAK = 3;
PomodoroManagerState.POTTYPAUSE = 4;
PomodoroManagerState.getStateName = function (state) {
	if (state == PomodoroManagerState.IDLE) {
		return "Idle";
	} else if (state == PomodoroManagerState.WORKING) {
		return "Working";
	} else if (state == PomodoroManagerState.SHORTBREAK) {
		return "Short Break";
	} else if (state == PomodoroManagerState.LONGBREAK) {
		return "Long Break";
	} else if (state == PomodoroManagerState.POTTYPAUSE) {
		return "Potty Pause";
	}
}

function PomodoroManager() {
	this.CurrentEntry = null;
	this.ShortBreakCount = 0;
	this.IntervalID = null;
	this.State = ko.observable(PomodoroManagerState.IDLE);
	this.Entries = ko.observableArray();
	this.SummaryEntries = ko.observableArray();
	this.CurrentTaskName = ko.observable("New Task");
	this.Timer = ko.observable(0);
	this.StateBeforePause = null;
	this.FormattedTimer = ko.computed(function() { return this.getFormattedTimer(); }, this);
	
	this.WorkTime = ko.observable(25);
	this.ShortBreakTime = ko.observable(5);
	this.MaxShortBreaks = ko.observable(3);
	this.LongBreakTime = ko.observable(15);
	this.EnableAudioNotifications = ko.observable(true);
	this.EnablePopupNotifications = ko.observable(true);
	this.EnableVibration = ko.observable(true);
	
	this.configureLocalStorage();
}

PomodoroManager.formatTimeDifference = function(seconds) {
	var hour = Math.floor(seconds / 3600);
	var min = Math.floor(seconds / 60) % 60;
	var sec = seconds % 60;
	
	return (hour > 0 ? hour + "h " : "") + (min > 0 ? PomodoroManager.addLeadingZeros(min,2) + "m " : "") + PomodoroManager.addLeadingZeros(sec,2) + "s";
	return hour + "m " + sec + "s";
}

PomodoroManager.addLeadingZeros = function(number, desiredDigitCount) {
	var strNum = number.toString();
	var numOfZeros = desiredDigitCount - strNum.length;
	if (numOfZeros > 0)  return new Array(numOfZeros + 1).join("0") + strNum;
	return strNum;
}

PomodoroManager.prototype.startTimer = function() {
	var promptResult = this.promptForNewTask();
	
	if (promptResult) {
		if (DeviceDetector.IsIOS()) AudioManager.load();
		this.State(PomodoroManagerState.WORKING);
		this.resetTimer();
		this.startEntry();
		if (this.EnablePopupNotifications()) NotificationManager.requestNotificationPermission();
		
		this.IntervalID = setInterval(this.loop(this), 1000);
	}
}
PomodoroManager.prototype.changeTask = function() {
	var oldTask = this.CurrentTaskName();
	
	this.promptForNewTask();
	
	var newTask = this.CurrentTaskName();
	
	if (newTask != oldTask) {
		this.endEntry();
		this.startEntry();
	}
}
PomodoroManager.prototype.stopTimer = function() {	
	this.endEntry();
	this.State(PomodoroManagerState.IDLE);
	this.resetTimer();
	clearInterval(this.IntervalID);
}
PomodoroManager.prototype.pottyPause = function() {
	if (this.State() == PomodoroManagerState.POTTYPAUSE)
	{
		this.endEntry();
		this.State(PomodoroManagerState.WORKING);
		this.IntervalID = setInterval(this.loop(this), 1000);
		this.startEntry();
	}
	else if (this.State() == PomodoroManagerState.WORKING)
	{
		this.endEntry();
		clearInterval(this.IntervalID);
		this.State(PomodoroManagerState.POTTYPAUSE);
		this.startEntry();
	}
}
PomodoroManager.prototype.loop = function(manager) {
	return function() {
		manager.Timer(manager.Timer() - 1);
		if (manager.Timer() == 0)
		{
			var oldState = manager.State();
			if (manager.EnableAudioNotifications()) AudioManager.play();
			if ("vibrate" in window.navigator && manager.EnableVibration()) window.navigator.vibrate([200,100,200,100,200]);
			manager.endEntry();
			manager.goToNextState();
			var newState = manager.State();
			if (manager.EnablePopupNotifications()) NotificationManager.notifyUser("Your " + PomodoroManagerState.getStateName(oldState) + " Pomodoro is over. Starting a " + PomodoroManagerState.getStateName(newState) + " Pomodoro now!");
			manager.startEntry();
		}
	}
}
PomodoroManager.prototype.goToNextState = function() {
	if (this.State() == PomodoroManagerState.IDLE) {
		return;
	} else if (this.State() == PomodoroManagerState.SHORTBREAK) {
		this.ShortBreakCount = this.ShortBreakCount + 1;
		this.State(PomodoroManagerState.WORKING);
		
		this.resetTimer();
	} else if (this.State() == PomodoroManagerState.LONGBREAK) {
		this.ShortBreakCount = 0;
		this.State(PomodoroManagerState.WORKING);
		this.resetTimer();
	} else {
		if (this.ShortBreakCount == this.MaxShortBreaks()) {
			this.State(PomodoroManagerState.LONGBREAK);
			this.resetTimer();
		} else {
			this.State(PomodoroManagerState.SHORTBREAK);
			this.resetTimer();
		}
	}
}
PomodoroManager.prototype.clearAllEntries = function() {
	this.Entries.removeAll();
}
PomodoroManager.prototype.promptForNewTask = function() {
	var taskname = window.prompt("What are you going to do now?", this.CurrentTaskName());
	
	if (taskname == null) {
		return false;
	} else {
		this.CurrentTaskName(!!taskname ? taskname : "New task");
		return true;
	}	
}
PomodoroManager.prototype.startEntry = function() {
	var newEntry = new PomodoroEntry();
	newEntry.Name = !!this.CurrentTaskName() ? this.CurrentTaskName() : "Unnamed Task";
	newEntry.State = this.State();
	newEntry.Parent = this;
	newEntry.Start(moment());
	this.CurrentEntry = newEntry;
}
PomodoroManager.prototype.endEntry = function() {
	this.CurrentEntry.End(moment());
	this.Entries.unshift(this.CurrentEntry);
	this.CurrentEntry = null;
}
PomodoroManager.prototype.resetTimer = function() {
	if (this.State() == PomodoroManagerState.WORKING) {
		this.Timer(this.WorkTime() * 60);
	} else if (this.State() == PomodoroManagerState.SHORTBREAK) {
		this.Timer(this.ShortBreakTime() * 60);
	} else if (this.State() == PomodoroManagerState.LONGBREAK) {
		this.Timer(this.LongBreakTime() * 60);
	} else if (this.State() == PomodoroManagerState.IDLE) {
		this.Timer(0);
	}
}
PomodoroManager.prototype.getFormattedTimer = function () {
	if (!this.Timer()) return "00:00";
	
	var div = Math.floor(this.Timer()/60);
	var rem = this.Timer() % 60;
	div = div < 10 ? "0" + div : div;
	rem = rem < 10 ? "0" + rem : rem;
	return div + ":" + rem;
}
PomodoroManager.prototype.configureLocalStorage = function () {
	//HTML5 Local Web Storage support
	if (typeof(Storage)!=="undefined") {
		this.updateVersion();
		
		if ("CurrentTaskName" in localStorage) this.CurrentTaskName(localStorage.CurrentTaskName);
		if ("WorkTime" in localStorage) this.WorkTime(localStorage.WorkTime * 1);
		if ("ShortBreakTime" in localStorage) this.ShortBreakTime(localStorage.ShortBreakTime * 1);
		if ("MaxShortBreaks" in localStorage) this.MaxShortBreaks(localStorage.MaxShortBreaks * 1);
		if ("LongBreakTime" in localStorage) this.LongBreakTime(localStorage.LongBreakTime * 1);
		if ("Entries" in localStorage) {
			var parsedEntries = JSON.parse(localStorage.Entries);
			var deserializedEntries = parsedEntries.map(function (element) { return PomodoroEntry.Deserialize(element, this); }, this);
			this.Entries(deserializedEntries);
		}
		if ("EnableAudioNotifications" in localStorage) this.EnableAudioNotifications = !!localStorage.EnableAudioNotifications;
		if ("EnablePopupNotifications" in localStorage) this.EnablePopupNotifications = !!localStorage.EnablePopupNotifications;
		if ("EnableVibration" in localStorage) this.EnableVibration = !!localStorage.EnableVibration;
		
		this.CurrentTaskName.subscribe(function(newValue) { localStorage.CurrentTaskName = newValue; });
		this.WorkTime.subscribe(function(newValue) { localStorage.WorkTime = newValue; });
		this.ShortBreakTime.subscribe(function(newValue) { localStorage.ShortBreakTime = newValue; });
		this.MaxShortBreaks.subscribe(function(newValue) { localStorage.MaxShortBreaks = newValue; });
		this.LongBreakTime.subscribe(function(newValue) { localStorage.LongBreakTime = newValue; });
		this.Entries.subscribe(function(newValue) { 
			var serializedEntries = newValue.map(PomodoroEntry.Serialize);
			var stringifiedEntries = JSON.stringify(serializedEntries);
			localStorage.Entries = stringifiedEntries; 
		});
		this.EnableAudioNotifications.subscribe(function(newValue) { localStorage.EnableAudioNotifications = newValue; });
		this.EnablePopupNotifications.subscribe(function(newValue) { localStorage.EnablePopupNotifications = newValue; });
		this.EnableVibration.subscribe(function(newValue) { localStorage.EnableVibration = newValue; });
	}
}
PomodoroManager.prototype.clearEntry = function (entry) {
	this.Parent.Entries.remove(entry);
}
PomodoroManager.prototype.updateVersion = function () {
	if (typeof(localStorage.Version)=="undefined") {
		console.log("Updating to version 1.0...");
		localStorage.Version = "1.0";
		localStorage.removeItem("Entries");
	}
}

PomodoroManager.prototype.updateSummary = function () {
	var newSummary = [];
	var entriesCache = this.Entries();
	for (var i in entriesCache) {
		var name = entriesCache[i].Name;
		var seconds = entriesCache[i].End().diff(entriesCache[i].Start(), 'seconds');
		var state = entriesCache[i].State;
		
		var existingSummaryRecords = newSummary.filter(function(e) { return e.Name == name; });
		
		if (existingSummaryRecords.length == 0) {
			var newSummaryEntry = new PomodoroSummaryEntry();
			newSummaryEntry.Name = name;
			newSummaryEntry.addTime(seconds, state);
			newSummary.push(newSummaryEntry);
		}
		else if (existingSummaryRecords.length == 1) {
			existingSummaryRecords[0].addTime(seconds, state);
		}
	}
	this.SummaryEntries(newSummary);
}
