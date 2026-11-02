/* 南审晴雨 · 校园共享雨伞
 * 数据层：伞点、身份、文明公约与演示数据
 * 所有数据保存在浏览器 localStorage 中，刷新页面不会丢失。
 */
(function () {
  'use strict';

  const APP_VERSION = 3;
  const STORAGE_KEY = 'nau-umbrella-state-v3';

  const zones = [
    {
      id: 'teaching',
      name: '教学区',
      short: '教学',
      color: '#2f6f5e',
      soft: '#e5efe9',
      icon: 'building',
      desc: '教学楼、图书馆与连廊'
    },
    {
      id: 'dorm',
      name: '生活区',
      short: '宿舍',
      color: '#4b7891',
      soft: '#e8f0f4',
      icon: 'bed',
      desc: '沁园、润园与泽园宿舍'
    },
    {
      id: 'canteen',
      name: '餐饮区',
      short: '食堂',
      color: '#a8752f',
      soft: '#f7eddc',
      icon: 'coffee',
      desc: '三大食堂与生活广场'
    }
  ];

  const stationSeed = [
    {
      id: 'st-mx',
      name: '敏行楼 · 东门',
      short: '敏行楼',
      zone: 'teaching',
      x: 24.5,
      y: 32.5,
      available: 24,
      capacity: 32,
      damaged: 0,
      distance: 120,
      walk: 2,
      hours: '07:00–22:30',
      code: 'MX-01',
      note: '靠近东侧台阶，晚自习下课顺路',
      tags: ['下课顺路', '高频']
    },
    {
      id: 'st-mz',
      name: '敏知楼 · 中庭',
      short: '敏知楼',
      zone: 'teaching',
      x: 39.5,
      y: 27,
      available: 18,
      capacity: 24,
      damaged: 1,
      distance: 260,
      walk: 4,
      hours: '07:00–22:30',
      code: 'MZ-02',
      note: '中庭咖啡店旁，雨棚下可取',
      tags: ['室内取伞']
    },
    {
      id: 'st-md',
      name: '敏达楼 · 北门',
      short: '敏达楼',
      zone: 'teaching',
      x: 55.5,
      y: 39.5,
      available: 13,
      capacity: 20,
      damaged: 0,
      distance: 340,
      walk: 5,
      hours: '07:30–22:00',
      code: 'MD-03',
      note: '北门门禁外侧，靠近主环路',
      tags: ['主环路']
    },
    {
      id: 'st-lib',
      name: '图书馆 · 南门',
      short: '图书馆',
      zone: 'teaching',
      x: 49.5,
      y: 60.5,
      available: 26,
      capacity: 30,
      damaged: 0,
      distance: 480,
      walk: 7,
      hours: '06:30–23:00',
      code: 'TS-04',
      note: '南门大厅左侧，自助借还机旁',
      tags: ['开放至23:00', '室内']
    },
    {
      id: 'st-qy',
      name: '沁园宿舍 · 3号楼',
      short: '沁园宿舍',
      zone: 'dorm',
      x: 24.5,
      y: 74.5,
      available: 17,
      capacity: 24,
      damaged: 0,
      distance: 180,
      walk: 3,
      hours: '全天开放',
      code: 'QY-05',
      note: '3号楼门厅，刷校园卡即可取还',
      tags: ['24小时']
    },
    {
      id: 'st-ry',
      name: '润园宿舍 · 服务中心',
      short: '润园宿舍',
      zone: 'dorm',
      x: 44.5,
      y: 85.5,
      available: 21,
      capacity: 28,
      damaged: 0,
      distance: 390,
      walk: 6,
      hours: '06:00–24:00',
      code: 'RY-06',
      note: '服务中心一楼值班室窗口',
      tags: ['有人值守']
    },
    {
      id: 'st-zy-dorm',
      name: '泽园宿舍 · 北门',
      short: '泽园宿舍',
      zone: 'dorm',
      x: 76.5,
      y: 82.5,
      available: 14,
      capacity: 22,
      damaged: 0,
      distance: 620,
      walk: 9,
      hours: '全天开放',
      code: 'ZY-07',
      note: '北门智能柜，夜间也可归还',
      tags: ['24小时', '智能柜']
    },
    {
      id: 'st-qy-canteen',
      name: '沁园食堂 · 正门',
      short: '沁园食堂',
      zone: 'canteen',
      x: 27.5,
      y: 59.5,
      available: 9,
      capacity: 18,
      damaged: 0,
      distance: 240,
      walk: 4,
      hours: '06:30–21:30',
      code: 'QC-08',
      note: '正门右侧雨伞架，饭后顺路归还',
      tags: ['用餐顺路']
    },
    {
      id: 'st-ry-canteen',
      name: '润园食堂 · 南广场',
      short: '润园食堂',
      zone: 'canteen',
      x: 51,
      y: 70.5,
      available: 11,
      capacity: 16,
      damaged: 1,
      distance: 460,
      walk: 7,
      hours: '06:30–21:30',
      code: 'RC-09',
      note: '南广场遮雨棚下，靠近快递站',
      tags: ['遮雨棚']
    },
    {
      id: 'st-zy-canteen',
      name: '泽园食堂 · 西门',
      short: '泽园食堂',
      zone: 'canteen',
      x: 76,
      y: 48.5,
      available: 8,
      capacity: 16,
      damaged: 0,
      distance: 580,
      walk: 8,
      hours: '06:30–21:30',
      code: 'ZC-10',
      note: '西门外卖柜旁，晚餐时段较忙',
      tags: ['晚餐高峰']
    }
  ];

  const usersSeed = {
    'u-student': {
      id: 'u-student',
      name: '林知雨',
      role: 'student',
      roleLabel: '学生',
      department: '金融学院',
      detail: '2023级 · 金融学',
      studentNo: '2023110428',
      credit: 98,
      baseTrips: 12,
      onTimeRate: 100,
      avatar: '林',
      tone: 'sage',
      joined: '2025-09-01'
    },
    'u-student-2': {
      id: 'u-student-2',
      name: '陈一诺',
      role: 'student',
      roleLabel: '学生',
      department: '会计学院',
      detail: '2023级 · 会计学',
      studentNo: '2023110516',
      credit: 100,
      baseTrips: 5,
      onTimeRate: 100,
      avatar: '陈',
      tone: 'clay',
      joined: '2025-09-01'
    },
    'u-teacher': {
      id: 'u-teacher',
      name: '周敏',
      role: 'teacher',
      roleLabel: '教师',
      department: '会计学院',
      detail: '讲师 · 审计系',
      studentNo: 'T20180612',
      credit: 100,
      baseTrips: 7,
      onTimeRate: 100,
      avatar: '周',
      tone: 'sand',
      joined: '2025-09-01'
    },
    'u-admin': {
      id: 'u-admin',
      name: '王建国',
      role: 'admin',
      roleLabel: '运维',
      department: '后勤保障处',
      detail: '校园服务 · 雨伞运维',
      studentNo: 'HQ-0091',
      credit: 100,
      baseTrips: 0,
      onTimeRate: 100,
      avatar: '王',
      tone: 'blue',
      joined: '2025-06-16'
    }
  };

  function daysAgo(days, hour, minute) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
  }

  function trip(id, from, to, days, hour, duration, condition) {
    return {
      id,
      code: 'NY26-' + String(100 + (days * 7 + hour) % 899),
      from,
      to,
      borrowedAt: daysAgo(days, hour, 12),
      returnedAt: new Date(new Date(daysAgo(days, hour, 12)).getTime() + duration * 60000).toISOString(),
      duration,
      condition: condition || 'good',
      status: 'returned'
    };
  }

  const historySeed = {
    'u-student': [
      trip('trip-s-1', '图书馆 · 南门', '敏行楼 · 东门', 4, 19, 82),
      trip('trip-s-2', '泽园食堂 · 西门', '泽园宿舍 · 北门', 9, 18, 46),
      trip('trip-s-3', '沁园食堂 · 正门', '沁园宿舍 · 3号楼', 16, 12, 22),
      trip('trip-s-4', '敏知楼 · 中庭', '图书馆 · 南门', 23, 15, 130, 'minor')
    ],
    'u-student-2': [
      trip('trip-c-1', '敏行楼 · 东门', '沁园食堂 · 正门', 3, 12, 34),
      trip('trip-c-2', '润园食堂 · 南广场', '润园宿舍 · 服务中心', 11, 18, 27)
    ],
    'u-teacher': [
      trip('trip-t-1', '敏行楼 · 东门', '图书馆 · 南门', 6, 16, 58),
      trip('trip-t-2', '图书馆 · 南门', '润园食堂 · 南广场', 18, 11, 37)
    ],
    'u-admin': []
  };

  const activitiesSeed = [
    {
      id: 'act-1',
      name: '匿名同学',
      action: '归还雨伞',
      station: '敏行楼 · 东门',
      detail: '用时 42 分钟',
      time: '2 分钟前',
      tone: 'sage'
    },
    {
      id: 'act-2',
      name: '李同学',
      action: '借出雨伞',
      station: '沁园食堂 · 正门',
      detail: '信用分 100',
      time: '6 分钟前',
      tone: 'sand'
    },
    {
      id: 'act-3',
      name: '刘老师',
      action: '归还雨伞',
      station: '图书馆 · 南门',
      detail: '伞况良好',
      time: '12 分钟前',
      tone: 'blue'
    },
    {
      id: 'act-4',
      name: '后勤保障处',
      action: '补充雨伞',
      station: '敏行楼 · 东门',
      detail: '补充 12 把',
      time: '28 分钟前',
      tone: 'clay'
    }
  ];

  const alertsSeed = [
    {
      id: 'alert-1',
      level: 'warning',
      title: '泽园食堂伞点库存偏低',
      desc: '当前可借 8 把，预计晚餐高峰后低于安全库存。',
      time: '10 分钟前',
      stationId: 'st-zy-canteen',
      resolved: false
    },
    {
      id: 'alert-2',
      level: 'danger',
      title: '2 把雨伞待检修',
      desc: '归还时检测到伞骨轻微变形，已从可借库存中锁定。',
      time: '32 分钟前',
      stationId: 'st-ry-canteen',
      resolved: false
    },
    {
      id: 'alert-3',
      level: 'info',
      title: '敏行楼 03 号柜通信波动',
      desc: '近 24 小时离线 2 次，建议巡检柜门网络模块。',
      time: '1 小时前',
      stationId: 'st-mx',
      resolved: false
    }
  ];

  const trend = [
    { day: '周一', borrow: 68, returned: 64, rain: '小雨' },
    { day: '周二', borrow: 42, returned: 40, rain: '阴' },
    { day: '周三', borrow: 91, returned: 86, rain: '中雨' },
    { day: '周四', borrow: 57, returned: 55, rain: '小雨' },
    { day: '周五', borrow: 106, returned: 98, rain: '大雨' },
    { day: '周六', borrow: 74, returned: 70, rain: '小雨' },
    { day: '周日', borrow: 86, returned: 83, rain: '中雨' }
  ];

  const weather = {
    city: '南京',
    campus: '浦口校区',
    temp: 17,
    feel: 16,
    condition: '中雨',
    rainMm: 6.4,
    humidity: 87,
    wind: '东北风 2 级',
    alert: '南京市气象台 18:20 发布：未来 3 小时降雨持续，晚自习出行请携带雨具。',
    updated: '19:00'
  };

  const DATA = {
    APP_VERSION,
    STORAGE_KEY,
    zones,
    stationSeed,
    usersSeed,
    historySeed,
    activitiesSeed,
    alertsSeed,
    trend,
    weather,
    pledgeSeed: {
      count: 2846,
      signedBy: []
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DATA;
  } else {
    window.NAU_DATA = DATA;
  }
})();
