export type RootStackParamList = {
  Auth: undefined;
  Tabs: undefined;
  GoalDetail: { id?: string; title?: string } | undefined;
  TodayDetails: undefined;
  ScheduleWeek: undefined;
};

export type TabsParamList = {
  Home: undefined;
  Calendar: { openEventId?: string; openEventStartAt?: string } | undefined;
  Goals: undefined;
  Ranking: undefined;
  Profile: undefined;
};
