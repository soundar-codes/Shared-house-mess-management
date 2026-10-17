import { members, foodStatus, bills, chores, notifications, foodConfig } from './mockData';

export const getMembers = () => members;

export const getFoodStatus = () => foodStatus;

export const getFoodConfig = () => foodConfig;

export const getBills = () => bills;

export const getChores = () => chores;

export const getNotifications = () => notifications;

export const updateFoodStatus = (userId, date, status) => {
  const index = foodStatus.findIndex(f => f.userId === userId && f.date === date);
  if (index >= 0) {
    foodStatus[index].status = status;
  } else {
    foodStatus.push({ id: Date.now(), userId, date, status });
  }
  return [...foodStatus]; // Return copy to trigger render
};
