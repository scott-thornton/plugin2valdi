package com.example.orphanhelp;

import com.getcapacitor.Bridge;

// Unportable helper: references the Capacitor bridge, so the translator
// skips copying it (java-helper-unportable) — its constants are still
// literalized at use sites and its fields are dropped with declarations.
public class Greeter {

    public static final String GREETING_HI = "hi";
    public static final String GREETING_BYE = "bye";

    public Greeter(Bridge bridge) {
        // bridge-backed greeter
    }

    public void greet(String who) {
        // no-op
    }
}
