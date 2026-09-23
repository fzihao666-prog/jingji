import { DatabaseSync } from 'node:sqlite';

export async function checkCoachDailyTodos({
  request,
  assert,
  databasePath,
  coachToken,
  adminToken,
  coachId,
  athletes,
}) {
  const project = 'ROWING';
  const path = `/api/coach/daily-todos?project=${project}`;
  const read = () => request(path, {}, coachToken);
  const allRows = (todos) => [...todos.missing, ...todos.attention, ...todos.incompleteTime];
  assert((await request(path)).status === 401, '每日待办必须要求登录');
  const athleteLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'athlete01', password: 'demo123' }),
  });
  assert(
    (await request(path, {}, athleteLogin.payload.token)).status === 403,
    '运动员不能读取教练每日待办'
  );
  for (const suffix of [
    '&date=2026-02-30',
    '&date=2000-01-01',
    '&date=2999-01-01',
    '&date=',
    '&athleteId=999',
    '&project=CANOE_SPRINT',
    '&date[]=2026-09-23',
  ]) {
    assert(
      (await request(path + suffix, {}, coachToken)).status === 400,
      `每日待办应拒绝非法查询 ${suffix}`
    );
  }
  assert(
    (await request('/api/coach/daily-todos?project=UNKNOWN', {}, coachToken)).status === 400,
    '每日待办应拒绝无效项目'
  );
  const initial = await read();
  assert(initial.status === 200, '教练每日待办未成功返回');
  const todos = initial.payload.todos;
  const scopedIds = athletes.filter((row) => row.project === project).map((row) => row.id);
  assert(todos.counts.total === scopedIds.length, '待办人数应等于教练权限范围');
  assert(
    allRows(todos).every((row) => scopedIds.includes(row.athleteId) && row.project === project),
    '待办不能泄漏权限外运动员'
  );
  assert(
    (await request(`${path}&date=${todos.date}`, {}, coachToken)).status === 200,
    '每日待办应接受服务端当前日期'
  );
  const target = todos.missing[0];
  const injuryTarget = todos.missing[1];
  assert(target && injuryTarget, '隔离测试数据库缺少待办样例运动员');
  const now = new Date();
  const startTime = new Date(now.getTime() + 8 * 3600000).toISOString().slice(11, 16);
  const save = await request(
    '/api/special-training/sessions',
    {
      method: 'POST',
      body: JSON.stringify({
        sessions: [
          {
            athleteId: target.athleteId,
            project,
            date: todos.date,
            startTime,
            type: '专项训练',
            content: '每日待办API回归',
            duration: 120,
            distance: 15,
            rpe: 5,
            heartRate: 140,
            maxHeartRate: 175,
            power: 200,
            strokeRate: 24,
          },
        ],
      }),
    },
    coachToken
  );
  assert(save.status === 201, '每日待办测试训练填报失败');
  const afterSave = (await read()).payload.todos;
  assert(
    !afterSave.missing.some((row) => row.athleteId === target.athleteId),
    '填报后必须移出未填报名单'
  );
  assert(
    afterSave.attention.some(
      (row) => row.athleteId === target.athleteId && row.highLoad && row.load24h === 600
    ),
    '正式训练应触发600AU关注'
  );

  const injuryInput = {
    bodyPart: '肩部',
    injuryName: '待办回归关注',
    side: 'left',
    status: 'observation',
    painScore: 3,
    onsetDate: todos.date,
  };
  const injuryPath = `/api/athletes/${injuryTarget.athleteId}/injuries`;
  assert(
    (await request(injuryPath, { method: 'POST', body: JSON.stringify(injuryInput) }, coachToken))
      .status === 201,
    '待办回归伤病写入失败'
  );
  const afterInjury = (await read()).payload.todos;
  assert(
    afterInjury.attention.some(
      (row) => row.athleteId === injuryTarget.athleteId && row.injury?.recent
    ),
    '近24小时新增伤病应触发关注'
  );
  assert(
    (
      await request(
        injuryPath,
        {
          method: 'POST',
          body: JSON.stringify({ ...injuryInput, status: 'healthy', painScore: 0 }),
        },
        coachToken
      )
    ).status === 201,
    '待办回归恢复写入失败'
  );
  assert(
    !(await read()).payload.todos.attention.some((row) => row.athleteId === injuryTarget.athleteId),
    '最新健康状态必须解除旧伤病关注'
  );

  // 仅访问 api-check 自己创建的隔离数据库，不读取应用运行数据库。
  const fixtureDb = new DatabaseSync(databasePath);
  try {
    const grants = fixtureDb
      .prepare('SELECT project, granted_by FROM user_project_permissions WHERE user_id = ?')
      .all(coachId);
    fixtureDb.prepare('DELETE FROM user_project_permissions WHERE user_id = ?').run(coachId);
    try {
      fixtureDb
        .prepare(
          "INSERT INTO user_project_permissions (user_id, project, granted_by) VALUES (?, 'CANOE_SPRINT', ?)"
        )
        .run(coachId, coachId);
      assert((await read()).status === 403, '项目授权被撤回后必须拒绝访问');
      const empty = await request('/api/coach/daily-todos?project=CANOE_SPRINT', {}, coachToken);
      assert(
        empty.status === 200 &&
          empty.payload.todos.counts.total === 0 &&
          allRows(empty.payload.todos).length === 0,
        '有项目权限但无队员时必须返回空范围'
      );
    } finally {
      fixtureDb.prepare('DELETE FROM user_project_permissions WHERE user_id = ?').run(coachId);
      for (const grant of grants)
        fixtureDb
          .prepare(
            'INSERT INTO user_project_permissions (user_id, project, granted_by) VALUES (?, ?, ?)'
          )
          .run(coachId, grant.project, grant.granted_by);
    }
    const record = fixtureDb
      .prepare(
        "SELECT id FROM training_sessions WHERE athlete_id = ? AND content = '每日待办API回归'"
      )
      .get(target.athleteId);
    fixtureDb.prepare("UPDATE training_sessions SET start_time = '' WHERE id = ?").run(record.id);
    const incomplete = (await read()).payload.todos;
    assert(
      incomplete.incompleteTime.some((row) => row.athleteId === target.athleteId),
      '缺少时间必须单列提示'
    );
    assert(
      !incomplete.attention.some((row) => row.athleteId === target.athleteId && row.highLoad),
      '缺少时间不能伪造24小时负荷'
    );
    fixtureDb
      .prepare('UPDATE training_sessions SET start_time = ?, is_demo = 1 WHERE id = ?')
      .run(startTime, record.id);
    assert(
      (await read()).payload.todos.missing.some((row) => row.athleteId === target.athleteId),
      '演示标志记录不应消除正式填报待办'
    );
    fixtureDb.prepare('UPDATE training_sessions SET is_demo = 0 WHERE id = ?').run(record.id);

    fixtureDb.prepare('UPDATE athletes SET active = 0 WHERE id = ?').run(target.athleteId);
    try {
      const inactive = (await read()).payload.todos;
      assert(
        inactive.counts.total === scopedIds.length - 1 &&
          !allRows(inactive).some((row) => row.athleteId === target.athleteId),
        '停用运动员不能出现在待办中'
      );
    } finally {
      fixtureDb.prepare('UPDATE athletes SET active = 1 WHERE id = ?').run(target.athleteId);
    }
    fixtureDb
      .prepare('DELETE FROM coach_athletes WHERE coach_user_id = ? AND athlete_id = ?')
      .run(coachId, target.athleteId);
    try {
      assert(
        !allRows((await read()).payload.todos).some((row) => row.athleteId === target.athleteId),
        '解绑后不得沿用旧权限'
      );
    } finally {
      fixtureDb
        .prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)')
        .run(coachId, target.athleteId);
    }
  } finally {
    fixtureDb.close();
  }

  for (const otherProject of ['CANOE_SPRINT', 'CANOE_SLALOM']) {
    const other = await request(`/api/coach/daily-todos?project=${otherProject}`, {}, adminToken);
    assert(
      other.status === 200 &&
        allRows(other.payload.todos).every((row) => row.project === otherProject),
      '每日待办项目必须隔离'
    );
    const coachOther = await request(
      `/api/coach/daily-todos?project=${otherProject}`,
      {},
      coachToken
    );
    assert(
      coachOther.status === 403 ||
        (coachOther.status === 200 && coachOther.payload.todos.counts.total === 0),
      '无队员的项目不得返回别人的名单'
    );
  }
}
