# Project Phoenix - Mobile App Integration Guide

## 🔥 About Project Phoenix

**Project Phoenix** is a community-driven preservation project by **9th Level Software LLC** designed to maintain functionality for smart cable training machines after the original manufacturer ceased operations. We are not affiliated with or endorsed by any equipment manufacturer - this is purely a community effort to preserve valuable training equipment.

---

## Overview

This web portal integrates seamlessly with the Project Phoenix mobile app, which tracks workouts on compatible smart cable machines. This document outlines the integration features and data sync capabilities between the mobile app and web portal.

## Integration Architecture

### Ecosystem Components

**📱 Project Phoenix Mobile App (Data Collection):**
- Real-time workout tracking during training sessions
- Direct integration with compatible smart cable machines
- Recording sets, reps, weight, power output, force curves
- Bluetooth connectivity to training equipment
- Quick workout logging and routine execution

**🌐 Project Phoenix Web Portal (Analytics & Community):**
- Comprehensive data visualization and insights
- Long-term progress tracking and trends
- Community features (routine sharing, challenges)
- Training cycle planning
- Deep analytics and performance metrics

---

## Real-Time Data Sync Features

### 1. Sync Status Widget
Located in the Dashboard, displays:
- **Connection Status**: Visual indicators for sync state
  - ✅ **Synced** (green) - All data is up to date
  - 🔄 **Syncing** (orange) - Currently syncing data
  - ⏳ **Pending** (gray) - Waiting for sync
  - ❌ **Error** (red) - Sync failed, requires attention
- **Last Sync Timestamp**: When data was last received
- **Manual Sync Trigger**: "Sync Now" button for on-demand updates

### 2. Automatic Background Sync
- Workouts automatically push from mobile to web after completion
- Routine and cycle changes sync bidirectionally
- Achievement and PR notifications in real-time

---

## Supported Training Modes

The system tracks workouts across various resistance modes available on smart cable machines:

| Mode | Description |
|------|-------------|
| **Old School** | Standard resistance with consistent weight |
| **Pump** | Optimized for hypertrophy with constant tension |
| **TUT** | Extended time under tension for muscle growth |
| **Echo** | Variable resistance that mirrors your force output |
| **Power** | Maximum power output focus |
| **Chains/Bands** | Accommodating resistance patterns |
| **Eccentric** | Focus on eccentric loading and control |

---

## Workout Data & Metrics

### Basic Metrics
- Weight (kg or lbs)
- Reps per set
- Number of sets
- Total workout volume
- Session duration
- Exercise names and categories

### Advanced Performance Metrics
Captured from smart cable machines:
- ⚡ **Peak Power Output** (Watts)
- 📊 **Average Power Output** (Watts)
- ⏱️ **Time Under Tension** (seconds per set)
- 🎯 **Rep Quality Score** (0-100% based on force curve consistency)
- 📈 **Concentric Force Curves** (force vs. time during lifting phase)
- 📉 **Eccentric Force Curves** (force vs. time during lowering phase)
- ⚖️ **Concentric/Eccentric Ratio** (movement control metric)

### Device Information
- Device model identifier (e.g., "V-Form Trainer")
- Session ID for tracking (format: PP-YYYY-MMDD-XXX)
- Sync timestamp
- Firmware version (if available)

---

## Workout Detail View

The web portal provides comprehensive post-workout analysis through three main tabs:

### 1. Exercises Tab
- Complete set-by-set breakdown
- All metrics displayed in table format
- Training mode indicators with descriptions
- PR achievements highlighted with badges
- Exercise notes and RPE ratings
- Visual rep quality indicators

### 2. Performance Metrics Tab
- **Power Output Chart**: Peak and average power trends across sets
- **Rep Quality Score**: Overall form consistency rating
- **Total Time Under Tension**: Cumulative TUT across all exercises
- **Consistency Rating**: How well you maintained performance across sets

### 3. Force Analysis Tab
- **Force Curve Visualization**: Dual-phase area charts showing concentric and eccentric force
- **Phase Analysis**: Breakdown of lifting and lowering phases
- **Peak Force Identification**: Maximum force points in each phase
- **Movement Quality Assessment**: Ratio analysis and recommendations

---

## Data Synchronization Flow

```
┌──────────────────────┐
│  Smart Cable Machine │
│   (V-Form Trainer)   │
└──────────┬───────────┘
           │ Bluetooth
           ▼
┌──────────────────────┐
│  Project Phoenix     │
│   Mobile App         │
│  (9th Level Software)│
└──────────┬───────────┘
           │ REST API / WebSocket
           ▼
┌──────────────────────┐
│  Project Phoenix     │
│   Web Portal         │
│  (This Application)  │
└──────────────────────┘
```

---

## API Integration Specifications

### Expected API Endpoints

#### 1. POST `/api/workouts/sync`
Pushes completed workout data from mobile to web portal.

**Request Payload Example:**
```json
{
  "sessionId": "PP-2026-0118-001",
  "userId": "user_abc123",
  "deviceModel": "V-Form Trainer",
  "deviceSerial": "VF-12345",
  "timestamp": "2026-01-18T14:34:00Z",
  "routineName": "Push Day A",
  "duration": 3480,
  "totalVolume": 5200,
  "exercises": [
    {
      "name": "Bench Press",
      "trainingMode": "Old School",
      "sets": [
        {
          "setNumber": 1,
          "weight": 100,
          "reps": 10,
          "peakPower": 580,
          "avgPower": 420,
          "timeUnderTension": 42,
          "repQuality": 94,
          "concentricCurve": [
            {"time": 0.0, "force": 0},
            {"time": 0.5, "force": 45},
            {"time": 1.0, "force": 120}
          ],
          "eccentricCurve": [
            {"time": 0.0, "force": 80},
            {"time": 0.5, "force": 110},
            {"time": 1.0, "force": 0}
          ]
        }
      ],
      "notes": "Felt strong today, hit a new PR!"
    }
  ],
  "prAchievements": [
    {
      "exercise": "Bench Press",
      "weight": 110,
      "reps": 6,
      "isPR": true,
      "previousBest": "105kg x 6"
    }
  ]
}
```

#### 2. POST `/api/routines/sync`
Syncs routine creations and modifications.

**Request Payload Example:**
```json
{
  "routineId": "routine_xyz789",
  "userId": "user_abc123",
  "name": "Upper Power Day",
  "category": "Strength",
  "exercises": [
    {
      "name": "Bench Press",
      "trainingMode": "Power",
      "sets": 5,
      "targetReps": 5,
      "targetWeight": 100,
      "restTime": 180
    }
  ],
  "createdAt": "2026-01-18T10:00:00Z",
  "modifiedAt": "2026-01-18T14:00:00Z"
}
```

#### 3. POST `/api/cycles/sync`
Syncs training cycle programs and schedules.

#### 4. GET `/api/routines/pull`
Retrieves routines from web portal to download to mobile app.

#### 5. POST `/api/achievements/notify`
Sends achievement, PR, and badge unlock notifications.

---

## Routine & Cycle Synchronization

### Mobile → Web Portal
- Routines created in mobile app appear in web portal's "My Routines" section
- Training cycles created in mobile sync to web calendar
- Workout schedules automatically update on web dashboard

### Web Portal → Mobile
- Routines created or modified on web portal can be downloaded to mobile
- Community routines from marketplace can be imported to mobile app
- Training cycle modifications sync back to mobile

---

## UI Components

### SyncStatus Component
**Location:** `/src/app/components/SyncStatus.tsx`

**Features:**
- Real-time sync state display
- Last sync timestamp
- Manual sync trigger button
- Error state handling and retry logic
- Visual status indicators

### WorkoutDetail Component
**Location:** `/src/app/components/WorkoutDetail.tsx`

**Features:**
- Comprehensive workout visualization
- Advanced performance metrics display
- Interactive force curve charts
- Set-by-set analysis tables
- Exercise mode indicators
- PR achievement badges
- Export and sharing functionality

---

## Testing Sync Status States

To test different sync states during development, update the `status` prop:

```tsx
// Dashboard.tsx
<SyncStatus lastSync="2 minutes ago" status="synced" />     // Green, all good
<SyncStatus lastSync="Just now" status="syncing" />         // Orange, in progress
<SyncStatus lastSync="1 hour ago" status="pending" />       // Gray, waiting
<SyncStatus lastSync="5 minutes ago" status="error" />      // Red, failed
```

---

## Mobile App Developer Guidelines

### Data Requirements
1. **Session IDs**: Use format `PP-YYYY-MMDD-XXX` (e.g., PP-2026-0118-001)
2. **Force Curves**: Sample at minimum 10Hz (10 data points per second)
3. **Power Output**: Always in Watts (W)
4. **Time Under Tension**: Always in seconds
5. **Rep Quality**: Percentage value (0-100)
6. **Timestamps**: Use ISO 8601 format (UTC)

### Best Practices
- Include device metadata with all workout syncs
- Send force curve data compressed to reduce bandwidth
- Implement retry logic for failed syncs
- Cache workouts locally until successful sync
- Use incremental sync when possible
- Batch multiple changes into single API calls

### Error Handling
- Detect network availability before sync attempts
- Queue failed syncs for retry
- Notify users of sync failures
- Provide manual sync option
- Log sync errors for debugging

---

## Future Enhancements

### Planned Features
1. **Real-Time Live Tracking**
   - Stream workout data during active session
   - Live metrics displayed on web dashboard
   - Multi-device viewing for coaches/trainers

2. **AI-Powered Insights**
   - Form analysis from force curves
   - Fatigue detection algorithms
   - Personalized training recommendations
   - Injury risk prediction

3. **Video Integration**
   - Sync video recordings with workouts
   - Form check overlays
   - Rep-by-rep playback with metrics

4. **Enhanced Social Features**
   - Share force curve comparisons
   - Challenge friends based on power metrics
   - Global leaderboards for specific exercises

---

## Legal & Attribution

### Important Notes
- **Project Phoenix** is a product of **9th Level Software LLC**
- This is a **community preservation project** - we are NOT affiliated with or endorsed by any equipment manufacturer
- All equipment references are factual descriptions only
- Users retain ownership of their workout data
- No proprietary manufacturer data or firmware is distributed

### Open Source Commitment
This project aims to preserve the functionality of valuable training equipment that would otherwise become obsolete. We encourage community contributions and transparent development.

---

## Support & Contact

For technical questions, integration support, or bug reports:
- GitHub: [Project Phoenix Repository](https://github.com/DasBluEyedDevil/Project-Phoenix-MP)
- Developer: 9th Level Software LLC

---

**Last Updated:** January 18, 2026  
**Version:** 1.0.0  
**License:** Community Preservation Project
