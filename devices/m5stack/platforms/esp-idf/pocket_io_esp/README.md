# pocket_io_esp

Firmware factories for PocketJS I2C and UART worker nodes.

The I2C factory opens any 7-bit address from 0x08 to 0x77; eight handles
are open at once at most. On a hardware bus it borrows an existing IDF bus
handle and adds one device whose transfers carry their own address byte, so
every handle shares it and the IDF bus lock serializes each accepted script,
one defined-operation transaction, with board-native transfers. Without a bus
handle it drives a software bus on two pins (open drain, internal pull-ups,
clock stretching up to the script's timeout): the pins are configured when
the first handle opens and reset when the last one closes. Board-native code
that configures a device the worker also talks to must coordinate with the
application; the bus lock serializes transfers, not device state.

Opcode 1 is a script of register reads (step op 1), register writes (op 2)
and receives (op 3, `receive(layout)`: START, the address with the read bit
and the bytes, with no register byte). Opcode 2 (`I2CDevice.probe()`) is an address-only
transaction, START, the address byte and STOP, that completes ok when the
device acknowledges and failed when it does not. On a hardware bus it runs
through `i2c_master_execute_defined_operations` like a script:
`i2c_master_probe` leaves the IDF ISR's read position from an earlier read
that ended at a NACK, and the next completion then writes through it.

The UART factory fixes a port and pin routing; JavaScript selects only the
admitted line settings. With `rs485` the port runs in RS485 half-duplex mode
and `rts_pin` drives the transceiver's driver enable while bytes leave the
FIFO. Both drivers keep bounded storage and retain native users until close
completes.

ESP-IDF targets are ESP32-P4/S3/C3/C6; hardware validation covers the Tab5
ESP32-P4. There is no copied IDF driver source in this component. See
[the worker reference](../../../docs/WORKER.md) for wire formats, budgets,
cancellation and overflow behavior. `tools/test-worker-io.sh` tests the
standalone descriptor parser.
