/**
 * Standard SNMP OIDs for system information
 */
const SYSTEM_OIDS = {
    sysDescr: '1.3.6.1.2.1.1.1.0',
    sysName: '1.3.6.1.2.1.1.5.0',
    sysContact: '1.3.6.1.2.1.1.4.0',
    sysLocation: '1.3.6.1.2.1.1.6.0',
};
/**
 * Query SNMP system info from a host.
 * Uses the net-snmp package with SNMPv2c and 'public' community string.
 *
 * @param ip - Target IP address
 * @param logger - Logger instance
 * @param community - SNMP community string (default: 'public')
 * @param timeout - Timeout in ms
 */
export async function querySnmp(ip, logger, community = 'public', timeout = 3000) {
    try {
        // Dynamic import to handle missing module gracefully
        const snmp = await import('net-snmp');
        const session = snmp.default.createSession(ip, community, {
            timeout,
            retries: 0,
            version: snmp.default.Version2c,
        });
        const oids = Object.values(SYSTEM_OIDS);
        const result = await new Promise((resolve) => {
            const timer = setTimeout(() => {
                session.close();
                resolve(null);
            }, timeout + 1000);
            session.get(oids, (error, varbinds) => {
                clearTimeout(timer);
                session.close();
                if (error) {
                    logger.debug(`SNMP ${ip}: ${error.message}`);
                    resolve(null);
                    return;
                }
                const info = {};
                let hasData = false;
                for (const vb of varbinds) {
                    // Skip errors (noSuchObject, noSuchInstance, endOfMibView)
                    if (snmp.default.isVarbindError(vb))
                        continue;
                    const value = vb.value?.toString()?.trim();
                    if (!value)
                        continue;
                    if (vb.oid === SYSTEM_OIDS.sysDescr) {
                        info.sysDescr = value;
                        hasData = true;
                    }
                    else if (vb.oid === SYSTEM_OIDS.sysName) {
                        info.sysName = value;
                        hasData = true;
                    }
                    else if (vb.oid === SYSTEM_OIDS.sysContact) {
                        info.sysContact = value;
                        hasData = true;
                    }
                    else if (vb.oid === SYSTEM_OIDS.sysLocation) {
                        info.sysLocation = value;
                        hasData = true;
                    }
                }
                resolve(hasData ? info : null);
            });
        });
        if (result) {
            logger.debug(`SNMP ${ip}: sysName=${result.sysName || '-'}, sysDescr=${(result.sysDescr || '-').substring(0, 60)}`);
        }
        return result;
    }
    catch (error) {
        logger.debug(`SNMP ${ip}: module error - ${error instanceof Error ? error.message : 'unavailable'}`);
        return null;
    }
}
//# sourceMappingURL=snmp.js.map