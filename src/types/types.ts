export interface Reminder {
  chat_id: string;
  message: string;
  day_of_week: string;
  time: string;
  recurring: string;
}

export interface StartCommandMessage {
  chat: {
    id: number;
  };
}

export interface StartCommandMatch {
  [index: number]: string;
}
