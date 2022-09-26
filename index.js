require("dotenv").config();
const { strict: assert } = require("node:assert");
const dbus = require("dbus-next");
const spawn = require("child_process").spawn;

const bus = dbus.systemBus();

const address = process.env.DEVICE_MAC_ADDRESS;
assert.notEqual(address, undefined, "Missing address");

(async () => {
    const interface = await bus.getProxyObject("org.bluez", "/org/bluez/hci0/dev_" + address.replace(/:/g, "_"));
    
    assert.equal(Object.keys(interface.interfaces).length > 1, true, "Invalid device MAC address/device not paired");
    
    const properties = interface.getInterface("org.freedesktop.DBus.Properties");

    console.log("Connected to D-Bus and listening for disconnect events");

    properties.on("PropertiesChanged", (iface, changed) => {
        if (changed.Connected.value === false) {
            console.log("PropertiesChanged Connected false");
            // Timeout in case of manual re-connecting
            setTimeout(async () => {
                const isConnected = await properties.Get("org.bluez.Device1", "Connected");
                if (isConnected.value === false) {
                    lock();
                }
            }, 10e3);
        }
    });
})();

setInterval(() => {
    const proc = spawn("hcitool", ["rssi", address]);
    proc.stdout.on("data", data => {
        const d = data.toString().trim();
        if (d.startsWith("Not")) return;

        const val = Number(d.replace("RSSI return value: ", ""));
        if (isNaN(val)) {
            return console.error("NaN value??", d, data);
        }
        
        const threshold = process.env.RSSI_THRESHOLD && !isNaN(process.env.RSSI_THRESHOLD) ? Number(process.env.RSSI_THRESHOLD) : -5;

        if (val <= threshold) {
            console.debug("RSSI < -5 (" + val + ")");
            lock();
        }
    });
}, 10e3);

async function lock() {
    const bus = dbus.sessionBus();
    const obj = await bus.getProxyObject("org.freedesktop.ScreenSaver", "/ScreenSaver").catch(console.error);
    if (!obj) return;

    const interface = obj.getInterface("org.freedesktop.ScreenSaver");
    if (!interface) {
        return console.error("Failed to obtain interface", Object.keys(obj.interfaces).length);
    }
    
    console.debug("Got interface, attempting to lock");
    interface?.Lock();
}
