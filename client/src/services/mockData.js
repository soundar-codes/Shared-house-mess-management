export const members = [
  { id: 'user-1', name: 'Soundar M', role: 'ADMIN' },
  { id: 'user-2', name: 'Sanjay K', role: 'MEMBER' },
  { id: 'user-3', name: 'Mukesh S', role: 'MEMBER' },
  { id: 'user-4', name: 'Raj Priyan A', role: 'MEMBER' },
];

export const foodConfig = {
  defaultRate: 100,
};

export let foodStatus = [
  { id: 1, userId: 'user-1', date: '2026-10-01', status: 'FOOD_REQUIRED' },
  { id: 2, userId: 'user-1', date: '2026-10-02', status: 'CANCELLED' },
  { id: 3, userId: 'user-2', date: '2026-10-01', status: 'FOOD_REQUIRED' },
  { id: 4, userId: 'user-3', date: '2026-10-01', status: 'FOOD_REQUIRED' },
  { id: 5, userId: 'user-4', date: '2026-10-01', status: 'CANCELLED' },
];

export const bills = [
  {
    id: 'bill-1',
    userId: 'user-1',
    month: '2026-09',
    chargeableDays: 28,
    rate: 100,
    totalAmount: 2800,
    paidAmount: 2800,
    balance: 0,
    paymentStatus: 'PAID'
  },
  {
    id: 'bill-2',
    userId: 'user-2',
    month: '2026-09',
    chargeableDays: 30,
    rate: 100,
    totalAmount: 3000,
    paidAmount: 1500,
    balance: 1500,
    paymentStatus: 'PARTIAL'
  },
  {
    id: 'bill-3',
    userId: 'user-3',
    month: '2026-09',
    chargeableDays: 25,
    rate: 100,
    totalAmount: 2500,
    paidAmount: 0,
    balance: 2500,
    paymentStatus: 'PENDING'
  },
  {
    id: 'bill-4',
    userId: 'user-4',
    month: '2026-09',
    chargeableDays: 29,
    rate: 100,
    totalAmount: 2900,
    paidAmount: 2900,
    balance: 0,
    paymentStatus: 'PAID'
  }
];

export const chores = {
  vesselWashing: [
    { day: 'Monday', time: 'ALL_DAY', assigneeId: 'user-1', name: 'Soundar M' },
    { day: 'Tuesday', time: 'ALL_DAY', assigneeId: 'user-2', name: 'Sanjay K' },
    { day: 'Wednesday', time: 'ALL_DAY', assigneeId: 'user-3', name: 'Mukesh S' },
    { day: 'Thursday', time: 'ALL_DAY', assigneeId: 'user-4', name: 'Raj Priyan A' },
    { day: 'Friday', time: 'MORNING', assigneeId: 'user-1', name: 'Soundar M' },
    { day: 'Friday', time: 'EVENING', assigneeId: 'user-4', name: 'Raj Priyan A' },
    { day: 'Saturday', time: 'MORNING', assigneeId: 'user-2', name: 'Sanjay K' },
    { day: 'Saturday', time: 'EVENING', assigneeId: 'user-3', name: 'Mukesh S' },
    { day: 'Sunday', time: 'ALL_DAY', assigneeId: 'EVERYONE', name: 'EVERYONE' },
  ],
  otherAssignments: [
    { id: 1, task: 'Bathroom Cleaning', assigneeId: 'user-2', status: 'PENDING', dueDate: '2026-10-10' },
    { id: 2, task: 'Sink/Wash-area Cleaning', assigneeId: 'user-3', status: 'COMPLETED', dueDate: '2026-10-05' },
    { id: 3, task: 'House Cleaning', assigneeId: 'user-4', status: 'PENDING', dueDate: '2026-10-12' },
    { id: 4, task: 'Water Duty', assigneeId: 'user-1', status: 'PENDING', dueDate: '2026-10-08' },
  ]
};

export const notifications = [
  { id: 'notif-1', userId: 'user-1', title: 'Food Cancelled', message: 'Your food cancellation for Oct 2 has been confirmed.', date: '2026-10-01T10:00:00Z', read: false },
  { id: 'notif-2', userId: 'user-1', title: 'Chore Reminder', message: 'You are assigned to Water Duty tomorrow.', date: '2026-10-07T08:00:00Z', read: false },
  { id: 'notif-3', userId: 'user-1', title: 'Bill Generated', message: 'Your bill for September 2026 is generated.', date: '2026-10-01T00:00:00Z', read: true },
  { id: 'notif-4', userId: 'user-1', title: 'Mess Inform', message: "Please inform the mess regarding tomorrow's headcount by 9 PM.", date: '2026-10-07T18:00:00Z', read: false },
];
