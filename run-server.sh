#!/usr/bin/env bash
cd "/home/fanzh/apps/jingji-training-monitor"
exec env NODE_ENV=production PORT=8090 "/usr/bin/node" --import tsx server/index.ts
