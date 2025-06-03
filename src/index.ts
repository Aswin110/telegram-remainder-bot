import sqlite3 from "sqlite3";
import * as chrono from "chrono-node";
import dotenv from "dotenv";
import { StartCommandMatch, StartCommandMessage } from "./types/types";
import TelegramBot, { Message } from "node-telegram-bot-api";
import moment from "moment-timezone"; // Add moment-timezone for timezone handling

// Load .env variables
dotenv.config();

// Your Bot Token from BotFather
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error("Telegram bot token not found in .env");
}

// Init bot
const bot = new TelegramBot(token, { polling: true });

// Init database
const db = new sqlite3.Database("./reminders.db");

// Create table
db.run(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT,
    message TEXT,
    day_of_week TEXT,
    time TEXT,
    recurring TEXT
  )
`);

const daysOfWeek = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

// /start command
bot.onText(
  /\/start/,
  (msg: StartCommandMessage, match: StartCommandMatch | null) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
      chatId,
      `👋 Welcome to Reminder Bot!
      
Use the following commands to manage your reminders:

1. /addReminder - Add a new reminder.
   Example: /addReminder remind to take out waste every Sunday and Wednesday 8pm

2. /listReminders - List all your active reminders.

3. /deleteReminder [id] - Delete a specific reminder by its ID.
   Example: /deleteReminder 1

4. /updateReminder [id] [new_message] - Update a specific reminder's message by its ID.
   Example: /updateReminder 1 Take out trash every Sunday and Wednesday 8pm

5. /deleteReminders [id1,id2,...] - Delete multiple reminders at once.
   Example: /deleteReminders 1,3,5

Try any of these commands to manage your reminders!`
    );
  }
);

// /addReminder command
bot.onText(
  /\/addReminder (.+)/i,
  (msg: Message, match: RegExpExecArray | null) => {
    if (!match) return;

    const chatId = msg.chat.id;
    const text = match[1].toLowerCase();

    // Check if input contains the word "every"
    if (!text.includes("every")) {
      bot.sendMessage(
        chatId,
        '❗ Please use the word "every" to set recurring reminders.'
      );
      return;
    }

    // Split message into parts (message and day/time part)
    const [messagePartRaw, dayTimePartRaw] = text.split("every");

    // Clean up message part and day/time part
    const messagePart = messagePartRaw.replace(/^remind\s*/, "").trim();
    const dayTimePart = dayTimePartRaw.trim();

    // Extract days mentioned in the reminder
    const foundDays: string[] = daysOfWeek.filter((day) =>
      dayTimePart.toLowerCase().includes(day)
    );
    if (foundDays.length === 0) {
      bot.sendMessage(
        chatId,
        "❗ No days found. Mention days like Sunday, Wednesday."
      );
      return;
    }

    // Extract time (e.g., "2pm", "8pm") and ensure it's in a format chrono can parse
    const timePart = dayTimePart
      .split(" ")
      .filter((part) => part.match(/\d{1,2}(am|pm)/i))
      .join(" ");

    const parsedTime = chrono.parseDate(timePart);
    if (!parsedTime) {
      bot.sendMessage(
        chatId,
        "❗ No valid time found. Please specify a time like 2pm or 8pm."
      );
      return;
    }

    // Convert parsed time to IST (Indian Standard Time)
    const istTime = moment(parsedTime).tz("Asia/Kolkata", true).toDate();

    // Format the time in HH:mm format (for example, "20:00")
    const timeStr = istTime.toTimeString().slice(0, 5); // "20:00"

    // Save the reminder for each day
    foundDays.forEach((day) => {
      db.run(
        `INSERT INTO reminders (chat_id, message, day_of_week, time, recurring) VALUES (?, ?, ?, ?, ?)`,
        [chatId.toString(), messagePart, day, timeStr, "yes"]
      );
    });

    // Confirm the reminder was set
    bot.sendMessage(
      chatId,
      `✅ Reminder set for ${foundDays.join(", ")} at ${timeStr} IST`
    );
  }
);

// List reminders
bot.onText(/\/listReminders/, (msg: Message) => {
  const chatId = msg.chat.id;

  db.all(
    `SELECT * FROM reminders WHERE chat_id = ?`,
    [chatId.toString()],
    (
      err,
      rows: { id: number; message: string; day_of_week: string; time: string }[]
    ) => {
      if (err) {
        console.error("Database error:", err);
        bot.sendMessage(chatId, "❗ Error retrieving reminders.");
        return;
      }

      if (rows.length === 0) {
        bot.sendMessage(chatId, "❗ You have no reminders set.");
        return;
      }

      const reminderList = rows
        .map(
          (row) =>
            `ID: ${row.id} \nMessage: ${row.message} \nDay: ${row.day_of_week} \nTime: ${row.time}`
        )
        .join("\n\n");

      bot.sendMessage(chatId, `📋 Your Reminders:\n\n${reminderList}`);
    }
  );
});

// Delete reminder
bot.onText(
  /\/deleteReminder (\d+)/,
  (msg: Message, match: RegExpExecArray | null) => {
    if (!match) return;

    const chatId = msg.chat.id;
    const reminderId = parseInt(match[1]);

    db.run(
      `DELETE FROM reminders WHERE id = ? AND chat_id = ?`,
      [reminderId, chatId.toString()],
      function (err) {
        if (err) {
          console.error("Database error:", err);
          bot.sendMessage(chatId, "❗ Error deleting reminder.");
          return;
        }

        if (this.changes === 0) {
          bot.sendMessage(
            chatId,
            `❗ No reminder found with ID ${reminderId}.`
          );
          return;
        }

        bot.sendMessage(chatId, `✅ Reminder with ID ${reminderId} deleted.`);
      }
    );
  }
);

// Delete multiple reminders
bot.onText(
  /\/deleteReminders (.+)/i,
  (msg: Message, match: RegExpExecArray | null) => {
    if (!match) return;

    const chatId = msg.chat.id;
    const reminderIds = match[1]
      .split(",")
      .map((id) => id.trim())
      .filter((id) => !isNaN(Number(id))); // Ensure the ID is valid

    if (reminderIds.length === 0) {
      bot.sendMessage(
        chatId,
        "❗ Please provide valid reminder IDs to delete."
      );
      return;
    }

    // Delete the reminders with the provided IDs
    reminderIds.forEach((id) => {
      db.run(
        `DELETE FROM reminders WHERE id = ? AND chat_id = ?`,
        [id, chatId.toString()],
        function (err) {
          if (err) {
            console.error("Database error:", err);
            bot.sendMessage(
              chatId,
              `❌ Failed to delete reminder with ID: ${id}`
            );
            return;
          }
        }
      );
    });

    bot.sendMessage(
      chatId,
      `✅ Successfully deleted reminders with IDs: ${reminderIds.join(", ")}`
    );
  }
);

// Update reminder
bot.onText(
  /\/updateReminder (\d+) (.+)/,
  (msg: Message, match: RegExpExecArray | null) => {
    if (!match) return;

    const chatId = msg.chat.id;
    const reminderId = parseInt(match[1]);
    const newMessage = match[2];

    db.run(
      `UPDATE reminders SET message = ? WHERE id = ? AND chat_id = ?`,
      [newMessage, reminderId, chatId.toString()],
      function (err) {
        if (err) {
          console.error("Database error:", err);
          bot.sendMessage(chatId, "❗ Error updating reminder.");
          return;
        }

        if (this.changes === 0) {
          bot.sendMessage(
            chatId,
            `❗ No reminder found with ID ${reminderId}.`
          );
          return;
        }

        bot.sendMessage(chatId, `✅ Reminder with ID ${reminderId} updated.`);
      }
    );
  }
);

// Handle polling errors
bot.on("polling_error", (error) => {
  console.error(
    "[polling_error]",
    error,
    error.message,
    error.name,
    error.stack
  );
});

// Handle webhook errors
bot.on("webhook_error", (error) => {
  console.error("[webhook_error]", error);
});

// Scheduler - runs every minute
setInterval(() => {
  const now = new Date();
  const today = daysOfWeek[now.getDay()];
  const currentTime = now.toTimeString().slice(0, 5); // "20:00"

  // Query the database for reminders matching today's date and time
  db.all(
    `SELECT * FROM reminders WHERE day_of_week = ? AND time = ?`,
    [today, currentTime],
    (err, rows: { chat_id: string; message: string }[]) => {
      if (err) {
        console.error("Database error:", err);
        return;
      }

      if (rows.length === 0) {
        console.log("No reminders for today.");
      }

      // Send reminders to users
      rows.forEach((row) => {
        bot.sendMessage(row.chat_id, `🔔 Reminder: ${row.message}`);
      });
    }
  );
}, 60000); // Check every minute
