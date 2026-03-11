【已載入技能：advanced-calendar】

# Advanced Calendar Skill for OpenClaw

A comprehensive calendar system with natural language processing, automatic reminders, and seamless WhatsApp notifications.

## Features

- **Natural Language Processing**: Create events using everyday language like "Schedule a meeting tomorrow at 3pm for 1 hour, remind me 30 minutes before"
- **Smart Parsing**: Automatically detects dates, times, durations, locations, and reminder preferences from your input
- **Interactive Creation**: When information is incomplete, the system asks for what it needs
- **Multi-Channel Notifications**: Sends notifications via WhatsApp and other configured channels (Discord, Telegram, Signal, etc.)
- **Persistent Reminders**: If no acknowledgment ("OK", "Got it", "Received", etc.) is received, reminders repeat every 15 minutes like a snooze alarm
- **Flexible Reminders**: Set reminders minutes, hours, or days in advance
- **Daily Summary**: Built-in daily summary feature - get a complete overview of today's schedule every morning
- **Complete CRUD Operations**: Create, read, update, delete calendar events
- **Local Storage**: All data stored locally, no external dependencies
- **Cron Integration**: Automatic reminder checking every 5 minutes and optional daily morning summary

## Installation

```bash
clawhub install advanced-calendar
```

## Usage

### Natural Language Commands

The skill understands natural language commands:

```
"Create a meeting tomorrow at 2pm to discuss the project, lasting 1 hour, remind me 30 minutes before"
"Schedule a call with John next Tuesday at 10am, remind me 1 hour ahead"
"I have lunch with Sarah today at 12:30pm"
"Show me my calendar for this week"
"What meetings do I have tomorrow?"
```

### Manual Commands

For more control, you can use structured commands:

```bash
# Create an event
calendar create --title "Event Title" --date YYYY-MM-DD --time HH:MM [--duration MINUTES] [--location LOCATION] [--description DESCRIPTION] [--reminder MINUTES_BEFORE]

# List upcoming events
calendar list [--days N] [--from YYYY-MM-DD] [--to YYYY-MM-DD]

# Get event details
calendar get --id EVENT_ID

# Update an event
calendar update --id EVENT_ID [--title TITLE] [--date YYYY-MM-DD] [--time HH:MM] [--duration MINUTES] [--location LOCATION] [--description DESCRIPTION] [--reminder MINUTES_BEFORE]

# Delete an event
calendar delete --id EVENT_ID

# Daily summary
calendar daily-summary
```

### Integration

The skill automatically integrates with OpenClaw's natural language processing. Simply speak to your OpenClaw instance naturally about scheduling, and it will handle the calendar operations.

## Configuration

After installation, you may want to configure:

1. Multi-channel notifications (WhatsApp, Discord, Telegram, Signal, etc.)
2. Default reminder time preferences
3. Default event duration
4. Repeat reminder intervals (default: every 15 minutes until acknowledged)
5. Acknowledgment keywords (default: "OK", "Got it", "Received", "Understood", "Ack", etc.)

## Examples

### Basic Event Creation
```
User: "Schedule a team meeting tomorrow at 10am"
System: [Asks for missing details like duration and reminder]
```

### Complete Event Specification
```
User: "I have a doctor appointment next Friday at 2:30pm, lasts 45 minutes, please remind me 2 hours before"
System: ✅ Created event: Doctor appointment
      Time: 2026-02-13 14:30, Duration: 45 minutes, Reminder: 120 minutes before
```

### Event Querying
```
User: "What do I have scheduled this week?"
System: [Lists all events for the next 7 days]
```

### Daily Summary
```
User: "Show me my schedule for today"
System: 📅 2026年02月03日 周二

      今日共有 3 个日程：

      1. 团队会议
         ⏰ 09:00
         📍 总部会议室

      2. 客户午餐
         ⏰ 12:30
         📍 赛特大厦

      3. 项目汇报
         ⏰ 15:00
         📝 季度项目进展汇报

      祝您今天顺利！
```

### Automated Daily Summary (Optional)
You can configure automatic daily summaries to be sent every morning at 9:00 AM:

```bash
# Via OpenClaw Cron - add this job to send daily summary automatically
openclaw cron add \
  --name "daily-calendar-summary" \
  --schedule "0 9 * * *" \
  --command "calendar daily-summary"
```

Or via natural language:
```
User: "Set up a daily reminder every morning at 9am with my calendar summary"
System: ✅ Daily summary scheduled for 9:00 AM every day
```

## Architecture

- **Natural Language Processor**: Interprets human language into calendar events
- **Intent Detection**: Identifies whether user wants to create, list, update, delete, or get daily summary of events
- **Information Extraction**: Parses dates, times, durations, locations, and reminders from text
- **Interactive Handler**: Manages conversations when information is incomplete
- **Daily Summary Generator**: Creates formatted daily overview with all scheduled events
- **Storage Layer**: JSON-based persistent storage
- **Multi-Channel Notification System**: Automated reminders via WhatsApp, Discord, Telegram, Signal, and other configured channels
- **Persistent Reminder Engine**: Snooze-alarm-style repeated notifications every 15 minutes until acknowledged
- **Acknowledgment Tracker**: Monitors for user responses to stop repeated notifications
- **Cron Integration**: Scheduled reminder checks and optional daily morning summaries

## Technical Requirements

- OpenClaw 1.0+
- Python 3.6+
- At least one notification channel configured (WhatsApp, Discord, Telegram, Signal, etc.)

## Dependencies

This skill requires the following Python packages which will be installed automatically during skill installation:

- python-docx
- lxml

The skill includes a virtual environment setup script that will create and manage dependencies automatically.

## Customization

The skill can be customized by modifying:
- Default reminder times
- Natural language parsing rules
- Notification preferences
- Storage location

## Troubleshooting

- If events aren't showing up, check that the date/time format is correct
- If reminders aren't working, verify WhatsApp is properly configured
- For parsing issues, try being more explicit with dates and times

## Contributing

We welcome contributions! Please see our contributing guidelines in the repository.

## Support

For support, please open an issue in the GitHub repository or visit the OpenClaw community forums.