export type RootStackParamList = {
  Auth: undefined;
  Tabs: undefined;
  GoalDetail: { id?: string; title?: string } | undefined;
  TodayDetails: undefined;
  GoalsDetails: undefined;
  ScheduleWeek: undefined;
  NotificationList: undefined;
  NotificationSettings: undefined;
  AiGoalRecommendation: { id: string };
  Progress: undefined;
  SmartGoalProof: { goalId: string; goalTitle: string; requirementText?: string | null };
  AdminProofReview: undefined;
};

export type TabsParamList = {
  Home: undefined;
  Calendar: { openEventId?: string; openEventStartAt?: string } | undefined;
  Goals: undefined;
  Ranking: undefined;
  Profile: undefined;
};
