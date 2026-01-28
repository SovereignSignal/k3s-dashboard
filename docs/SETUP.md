# Setup Guide

This guide walks through setting up the K3s Dashboard on a Raspberry Pi cluster.

## Prerequisites

### Hardware
- Raspberry Pi cluster (tested with Pi 4/5)
- Network connectivity between all nodes
- Optional: SSD storage on some nodes

### Software
- Raspberry Pi OS (Debian-based)
- k3s installed and running
- Node.js 18 or later
- SSH access configured between nodes (for network monitoring)

## Step 1: Install Node.js

If Node.js is not installed:

```bash
# Using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify installation
node --version
npm --version
```

## Step 2: Clone and Install

```bash
# Clone the repository
cd /home/pi-admin
git clone https://github.com/SovereignSignal/k3s-dashboard.git
cd k3s-dashboard

# Install dependencies
npm install
```

## Step 3: Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Generate session secret
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
echo "Generated session secret"

# Generate password hash (change 'your-password' to your desired password)
PASSWORD_HASH=$(node -e "require('bcrypt').hash('your-password', 12).then(h => console.log(h))")
echo "Generated password hash"

# Edit the .env file
nano .env
```

### Environment File Contents

```bash
# Server binding
PORT=3000
BIND_ADDRESS=192.168.50.22  # Change to your server's IP

# Session configuration
SESSION_SECRET=<paste-generated-secret>
PASSWORD_HASH=<paste-generated-hash>
SESSION_TTL_HOURS=8

# Kubeconfig (leave empty for default ~/.kube/config)
KUBECONFIG_PATH=
```

## Step 4: Verify Kubernetes Access

```bash
# Test that kubectl works
kubectl get nodes

# Should show your cluster nodes
NAME   STATUS   ROLES                  AGE   VERSION
pi1    Ready    control-plane,master   1d    v1.xx.x+k3s1
pi2    Ready    <none>                 1d    v1.xx.x+k3s1
...
```

## Step 5: Configure SSH Access (Optional)

For network monitoring and storage detection across nodes, SSH access is required:

```bash
# Generate SSH key if not exists
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519

# Copy to all other nodes
ssh-copy-id pi2
ssh-copy-id pi3
ssh-copy-id pi4

# Test passwordless SSH
ssh pi2 "hostname"
```

## Step 6: Test the Dashboard

```bash
# Start in development mode
npm run dev

# Or start normally
npm start
```

Open `http://<your-ip>:3000` in a browser and log in with your password.

## Step 7: Install as System Service

```bash
# Copy service file
sudo cp k3s-dashboard.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable k3s-dashboard

# Start the service
sudo systemctl start k3s-dashboard

# Verify it's running
sudo systemctl status k3s-dashboard
```

## Step 8: Configure SSD Storage (Optional)

If you have nodes with SSD drives:

### Label SSD Nodes

```bash
# Identify which nodes have SSDs
# (check lsblk output on each node)

# Label them
kubectl label node pi1 storage.kubernetes.io/ssd=true
kubectl label node pi4 storage.kubernetes.io/ssd=true
```

### Create SSD Directories

On each SSD-equipped node:

```bash
sudo mkdir -p /mnt/ssd/k3s-storage
sudo chmod 755 /mnt/ssd/k3s-storage
```

### Create SSD StorageClass

```bash
kubectl apply -f - <<EOF
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-path-ssd
provisioner: rancher.io/local-path
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
parameters:
  nodePath: /mnt/ssd/k3s-storage
allowedTopologies:
- matchLabelExpressions:
  - key: storage.kubernetes.io/ssd
    values:
    - "true"
EOF
```

## Troubleshooting

### Dashboard won't start

```bash
# Check logs
sudo journalctl -u k3s-dashboard -n 50

# Common issues:
# - Missing .env file
# - Invalid PASSWORD_HASH format
# - Port already in use
```

### Can't connect to Kubernetes API

```bash
# Check kubeconfig
echo $KUBECONFIG
cat ~/.kube/config

# Test kubectl
kubectl cluster-info
```

### Network monitoring shows SSH errors

```bash
# Test SSH to each node
ssh pi2 "echo ok"

# If it prompts for password, set up key-based auth
ssh-copy-id pi2
```

### Storage not showing for some nodes

```bash
# SSH must work for storage detection
# Also verify lsblk works on remote nodes
ssh pi2 "lsblk -J"
```

## Updating

```bash
cd /home/pi-admin/k3s-dashboard

# Pull latest changes
git pull

# Install any new dependencies
npm install

# Restart the service
sudo systemctl restart k3s-dashboard
```

## Backup

Important files to backup:

```bash
# Environment configuration
/home/pi-admin/k3s-dashboard/.env

# Alert data (if you want to preserve alert history)
/home/pi-admin/k3s-dashboard/data/
```
