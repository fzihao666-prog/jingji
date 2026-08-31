import {
  BatteryCharging,
  Bluetooth,
  BluetoothConnected,
  BluetoothOff,
  CheckCircle2,
  LoaderCircle,
  RadioTower,
  RefreshCcw,
  Send,
  ShieldAlert,
  Smartphone,
  Unplug,
  Zap
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { User } from '../types';

type Props = {
  user: User;
};

type BluetoothCharacteristicPropertiesLike = {
  read?: boolean;
  write?: boolean;
  writeWithoutResponse?: boolean;
  notify?: boolean;
};

type BluetoothRemoteGATTCharacteristicLike = EventTarget & {
  uuid?: string;
  value?: DataView;
  properties?: BluetoothCharacteristicPropertiesLike;
  readValue?: () => Promise<DataView>;
  writeValue?: (value: BufferSource) => Promise<void>;
  writeValueWithResponse?: (value: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
  startNotifications?: () => Promise<BluetoothRemoteGATTCharacteristicLike>;
  stopNotifications?: () => Promise<BluetoothRemoteGATTCharacteristicLike>;
};

type BluetoothRemoteGATTServiceLike = {
  uuid?: string;
  getCharacteristic: (characteristic: string) => Promise<BluetoothRemoteGATTCharacteristicLike>;
};

type BluetoothRemoteGATTServerLike = {
  connected?: boolean;
  connect: () => Promise<BluetoothRemoteGATTServerLike>;
  disconnect: () => void;
  getPrimaryService: (service: string) => Promise<BluetoothRemoteGATTServiceLike>;
};

type BluetoothDeviceLike = EventTarget & {
  id?: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServerLike;
};

type BluetoothRequestOptions = {
  acceptAllDevices?: boolean;
  filters?: Array<{ name?: string; namePrefix?: string; services?: string[] }>;
  optionalServices?: string[];
};

type BluetoothApiLike = {
  requestDevice: (options: BluetoothRequestOptions) => Promise<BluetoothDeviceLike>;
};

type NavigatorWithBluetooth = Navigator & {
  bluetooth?: BluetoothApiLike;
};

type ConnectionStatus = 'idle' | 'requesting' | 'connecting' | 'connected' | 'unsupported' | 'error';

const serviceOptions = [
  { label: '健身设备 FTMS', value: 'fitness_machine', note: '赛艇机、测功仪等常见训练设备' },
  { label: '心率', value: 'heart_rate', note: '心率带、心率臂带' },
  { label: '电量', value: 'battery_service', note: '读取设备电池' },
  { label: '设备信息', value: 'device_information', note: '读取厂商与型号' },
  { label: '自定义', value: 'custom', note: '手动填写服务 UUID' }
];

const defaultOptionalServices = [
  'fitness_machine',
  'heart_rate',
  'battery_service',
  'device_information',
  '00001826-0000-1000-8000-00805f9b34fb',
  '0000180d-0000-1000-8000-00805f9b34fb',
  '0000180f-0000-1000-8000-00805f9b34fb',
  '0000180a-0000-1000-8000-00805f9b34fb'
];

function nowLabel() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function formatBytes(view: DataView) {
  const bytes = Array.from({ length: view.byteLength }, (_item, index) => view.getUint8(index));
  if (!bytes.length) return '空数据';
  return bytes.map((byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function normalizeUuid(value: string) {
  return value.trim();
}

function getBluetoothApi() {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as NavigatorWithBluetooth).bluetooth;
}

function getSecurityHint() {
  if (typeof window === 'undefined') return '';
  if (window.isSecureContext) return '';
  return '浏览器蓝牙需要 HTTPS 或 localhost。当前如果是 http://服务器IP，页面会保留入口，但真机连接需要配置 HTTPS 后使用。';
}

export function BluetoothConnectPage({ user }: Props) {
  const bluetoothApi = getBluetoothApi();
  const securityHint = getSecurityHint();
  const supported = Boolean(bluetoothApi) && !securityHint;
  const [status, setStatus] = useState<ConnectionStatus>(supported ? 'idle' : 'unsupported');
  const [device, setDevice] = useState<BluetoothDeviceLike | null>(null);
  const [server, setServer] = useState<BluetoothRemoteGATTServerLike | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [servicePreset, setServicePreset] = useState('fitness_machine');
  const [customServiceUuid, setCustomServiceUuid] = useState('00001826-0000-1000-8000-00805f9b34fb');
  const [characteristicUuid, setCharacteristicUuid] = useState('00002ad1-0000-1000-8000-00805f9b34fb');
  const [commandText, setCommandText] = useState('');
  const [lastValue, setLastValue] = useState('');
  const [logs, setLogs] = useState<string[]>([]);
  const notifyCharacteristicRef = useRef<BluetoothRemoteGATTCharacteristicLike | null>(null);

  const selectedServiceUuid = useMemo(() => {
    return servicePreset === 'custom' ? normalizeUuid(customServiceUuid) : servicePreset;
  }, [customServiceUuid, servicePreset]);

  const connectionLabel = server?.connected ? '已连接' : device ? '已选择设备' : '未连接';

  function pushLog(message: string) {
    setLogs((items) => [nowLabel() + '  ' + message, ...items].slice(0, 12));
  }

  function handleDisconnected() {
    setServer(null);
    setStatus('idle');
    pushLog('蓝牙设备已断开');
  }

  async function tryReadBattery(activeServer: BluetoothRemoteGATTServerLike) {
    try {
      const batteryService = await activeServer.getPrimaryService('battery_service');
      const batteryLevel = await batteryService.getCharacteristic('battery_level');
      const value = await batteryLevel.readValue?.();
      if (value) {
        setBattery(value.getUint8(0));
        pushLog('已读取设备电量 ' + value.getUint8(0) + '%');
      }
    } catch {
      setBattery(null);
    }
  }

  async function connectDevice() {
    if (!bluetoothApi || securityHint) {
      setStatus('unsupported');
      pushLog(securityHint || '当前浏览器不支持 Web Bluetooth');
      return;
    }

    try {
      setStatus('requesting');
      pushLog('开始扫描附近蓝牙设备');
      const selected = await bluetoothApi.requestDevice({
        acceptAllDevices: true,
        optionalServices: defaultOptionalServices
      });

      setDevice(selected);
      selected.addEventListener?.('gattserverdisconnected', handleDisconnected);
      if (!selected.gatt) throw new Error('该设备没有开放 GATT 服务');

      setStatus('connecting');
      pushLog('正在连接 ' + (selected.name || '未命名设备'));
      const connectedServer = await selected.gatt.connect();
      setServer(connectedServer);
      setStatus('connected');
      pushLog('连接成功');
      await tryReadBattery(connectedServer);
    } catch (error) {
      setStatus('error');
      pushLog(error instanceof Error ? error.message : '连接失败');
    }
  }

  function disconnectDevice() {
    try {
      notifyCharacteristicRef.current?.stopNotifications?.();
      server?.disconnect();
    } finally {
      notifyCharacteristicRef.current = null;
      setServer(null);
      setStatus('idle');
      pushLog('已手动断开连接');
    }
  }

  async function resolveCharacteristic() {
    if (!server?.connected) throw new Error('请先连接蓝牙设备');
    const serviceUuid = normalizeUuid(selectedServiceUuid);
    const charUuid = normalizeUuid(characteristicUuid);
    if (!serviceUuid || !charUuid) throw new Error('请填写服务 UUID 和特征值 UUID');
    const service = await server.getPrimaryService(serviceUuid);
    return service.getCharacteristic(charUuid);
  }

  async function readCharacteristic() {
    try {
      const characteristic = await resolveCharacteristic();
      if (!characteristic.readValue) throw new Error('该特征值不支持读取');
      const value = await characteristic.readValue();
      const formatted = formatBytes(value);
      setLastValue(formatted);
      pushLog('读取成功：' + formatted);
    } catch (error) {
      setStatus('error');
      pushLog(error instanceof Error ? error.message : '读取失败');
    }
  }

  async function startNotify() {
    try {
      const characteristic = await resolveCharacteristic();
      if (!characteristic.startNotifications) throw new Error('该特征值不支持监听');
      const activeCharacteristic = await characteristic.startNotifications();
      activeCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
        const target = event.target as BluetoothRemoteGATTCharacteristicLike;
        if (!target.value) return;
        const formatted = formatBytes(target.value);
        setLastValue(formatted);
        pushLog('收到数据：' + formatted);
      });
      notifyCharacteristicRef.current = activeCharacteristic;
      pushLog('已开始监听特征值数据');
    } catch (error) {
      setStatus('error');
      pushLog(error instanceof Error ? error.message : '监听失败');
    }
  }

  async function sendCommand() {
    try {
      const text = commandText.trim();
      if (!text) throw new Error('请先填写要发送的指令');
      const characteristic = await resolveCharacteristic();
      const payload = new TextEncoder().encode(text);
      if (characteristic.writeValueWithResponse) {
        await characteristic.writeValueWithResponse(payload);
      } else if (characteristic.writeValue) {
        await characteristic.writeValue(payload);
      } else if (characteristic.writeValueWithoutResponse) {
        await characteristic.writeValueWithoutResponse(payload);
      } else {
        throw new Error('该特征值不支持写入');
      }
      pushLog('已发送指令：' + text);
      setCommandText('');
    } catch (error) {
      setStatus('error');
      pushLog(error instanceof Error ? error.message : '发送失败');
    }
  }

  const busy = status === 'requesting' || status === 'connecting';

  return (
    <div className="page-content bluetooth-page">
      <div className="page-heading bluetooth-heading">
        <div>
          <span className="eyebrow">BLUETOOTH LINK</span>
          <h1>蓝牙连接</h1>
          <p>连接训练设备、心率带或测功仪，读取设备状态与训练数据。</p>
        </div>
        <div className="bluetooth-actions">
          <button className="secondary-button" type="button" onClick={connectDevice} disabled={busy}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Bluetooth size={16} />}扫描并连接
          </button>
          <button className="ghost-button" type="button" onClick={disconnectDevice} disabled={!device && !server}>
            <Unplug size={16} />断开
          </button>
        </div>
      </div>

      <section className="bluetooth-status-grid">
        <div className="bluetooth-status-card">
          <span><RadioTower size={16} />浏览器环境</span>
          <strong>{supported ? '可连接' : '受限'}</strong>
          <small>{securityHint || (bluetoothApi ? '支持 Web Bluetooth' : '当前浏览器不支持 Web Bluetooth')}</small>
        </div>
        <div className="bluetooth-status-card">
          <span><Smartphone size={16} />当前设备</span>
          <strong>{device?.name || '未选择设备'}</strong>
          <small>{connectionLabel}</small>
        </div>
        <div className="bluetooth-status-card">
          <span><BatteryCharging size={16} />设备电量</span>
          <strong>{battery === null ? '--' : battery + '%'}</strong>
          <small>连接后自动尝试读取</small>
        </div>
        <div className="bluetooth-status-card">
          <span><Zap size={16} />最近数据</span>
          <strong>{lastValue || '--'}</strong>
          <small>读取或监听后显示十六进制数据</small>
        </div>
      </section>

      {(securityHint || !bluetoothApi) && (
        <section className="bluetooth-warning">
          <ShieldAlert size={18} />
          <div>
            <strong>蓝牙入口已安装，但当前访问环境无法直接连接设备。</strong>
            <p>{securityHint || '请使用支持 Web Bluetooth 的 Chrome 或 Edge 浏览器。'}</p>
          </div>
        </section>
      )}

      <section className="panel bluetooth-panel">
        <div className="panel-heading">
          <div>
            <h2>设备数据通道</h2>
            <small>登录用户：{user?.username || '当前用户'}</small>
          </div>
          <span className={'bluetooth-chip ' + (server?.connected ? 'connected' : '')}>
            {server?.connected ? <BluetoothConnected size={15} /> : <BluetoothOff size={15} />}
            {connectionLabel}
          </span>
        </div>

        <div className="bluetooth-form-grid">
          <label>
            <span>服务类型</span>
            <select value={servicePreset} onChange={(event) => setServicePreset(event.target.value)}>
              {serviceOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>服务 UUID</span>
            <input
              value={selectedServiceUuid}
              disabled={servicePreset !== 'custom'}
              onChange={(event) => setCustomServiceUuid(event.target.value)}
              placeholder="例如 fitness_machine 或 00001826-..."
            />
          </label>
          <label>
            <span>特征值 UUID</span>
            <input
              value={characteristicUuid}
              onChange={(event) => setCharacteristicUuid(event.target.value)}
              placeholder="例如 00002ad1-0000-1000-8000-00805f9b34fb"
            />
          </label>
          <label>
            <span>发送指令</span>
            <input
              value={commandText}
              onChange={(event) => setCommandText(event.target.value)}
              placeholder="可选：写入设备的文本指令"
            />
          </label>
        </div>

        <div className="bluetooth-command-row">
          <button className="secondary-button" type="button" onClick={readCharacteristic} disabled={!server?.connected}>
            <RefreshCcw size={16} />读取特征值
          </button>
          <button className="secondary-button" type="button" onClick={startNotify} disabled={!server?.connected}>
            <CheckCircle2 size={16} />监听数据
          </button>
          <button className="primary-button" type="button" onClick={sendCommand} disabled={!server?.connected}>
            <Send size={16} />发送
          </button>
        </div>
      </section>

      <section className="panel bluetooth-log-panel">
        <div className="panel-heading">
          <div>
            <h2>连接日志</h2>
            <small>只记录本次页面操作，不影响其他训练数据。</small>
          </div>
        </div>
        {logs.length ? (
          <div className="bluetooth-log-list">
            {logs.map((item, index) => <div key={index}>{item}</div>)}
          </div>
        ) : (
          <div className="bluetooth-empty">等待扫描、连接或读取设备数据。</div>
        )}
      </section>
    </div>
  );
}
