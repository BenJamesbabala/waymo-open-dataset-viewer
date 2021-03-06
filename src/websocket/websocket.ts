import PointMesh from '../meshes/PointMesh';
import BoundingBoxMesh from '../meshes/BoundingBoxMesh';

export interface SegmentMetadata {
  size: number;
}

class DataSocket {
  private websocket: WebSocket;
  private segment: string;
  private segmentMetadata: SegmentMetadata;
  private segments: string[];
  
  private onFramePointCloudReceived: (index: number, mesh: THREE.Mesh) => void; 
  private onFrameBoundingBoxesReceived: (index: number, mesh: THREE.Mesh) => void; 
  private onSegmentChange: (segment: string) => void;
  private onSegmentsReceived: (segments: string[], self: DataSocket) => void;
  private onSegmentMetadataReceived: (metadata: SegmentMetadata) => void;

  constructor(
    onFramePointCloudReceived: (index: number, mesh: THREE.Mesh) => void,
    onFrameBoundingBoxesReceived: (index: number, mesh: THREE.Mesh) => void,
    onSegmentChange: (segment: string) => void, 
    onSegmentsReceived: (segments: string[], self: DataSocket) => void,
    onSegmentMetadataReceived: (metadata: SegmentMetadata) => void,
  ) {
    this.onFramePointCloudReceived = onFramePointCloudReceived;
    this.onFrameBoundingBoxesReceived = onFrameBoundingBoxesReceived;
    this.onSegmentChange = onSegmentChange;
    this.onSegmentsReceived = onSegmentsReceived;
    this.onSegmentMetadataReceived = onSegmentMetadataReceived;
  }

  public start() {
    this.websocket = new WebSocket('ws://localhost:9000');
    this.websocket.binaryType = 'arraybuffer';

    this.websocket.onopen = this.onOpen;
    this.websocket.onclose = this.onClose;
    this.websocket.onerror = this.onError;

    const this_ = this;
    this.websocket.addEventListener('message', function (event: MessageEvent) { this_.onMessage(this, event); });
  }

  public async changeSegment(segmentId: string) {
    this.onSegmentChange(segmentId);
    this.segment = segmentId;
    this.websocket.send(`${segmentId}_0_segment`);
    this.websocket.send(`${segmentId}_0_pointcloud`);
    this.websocket.send(`${segmentId}_0_labels`);
  }

  private onOpen() {
    console.log('Websocket open');
  }

  private onError() {
    console.log('Websocket error');
  }

  private onClose() {
    console.log('Websocket closed');
  }

  private handleSegmentsMessage(websocket: WebSocket, event: MessageEvent) {
    this.segments = event.data.split(',');
    this.onSegmentsReceived(this.segments, this);
  }

  private handleSegmentMetadataMessage(websocket: WebSocket, segmentId: string, data: Float32Array) {
    if (segmentId.substr(0, 5) !== this.segment.substr(0, 5)) {
      return;
    }

    const [size] = data;
    const metadata = { size };
    this.segmentMetadata = metadata;

    this.onSegmentMetadataReceived(metadata);
  }

  private handleBoundingBoxesMessage(websocket: WebSocket, segmentId: string, frameIndex: number, data: Float32Array) {
    if (segmentId.substr(0, 5) !== this.segment.substr(0, 5)) {
      return;
    }
    
    if (frameIndex < this.segmentMetadata.size - 1) {
      websocket.send(`${this.segment}_${frameIndex + 1}_labels`);
    }

    const numCols = 8;

    const offsets = [];
    const dimensions = [];
    const headings = [];

    data.forEach((x, index) => {
      if ([0, 1, 2].includes(index % numCols)) offsets.push(x);
      else if ([3, 4, 5].includes(index % numCols)) dimensions.push(x);
      else if (index % numCols === 6) headings.push(x);
    });

    const mesh = (new BoundingBoxMesh(headings.length, offsets, dimensions, headings)).getMesh();
    mesh.scale.x = 0.2;
    mesh.scale.y = 0.2;
    mesh.scale.z = 0.2;

    this.onFrameBoundingBoxesReceived(frameIndex, mesh);
  }

  private handlePointCloudMessage(websocket: WebSocket, segmentId: string, frameIndex: number, data: Float32Array) {
    if (segmentId.substr(0, 5) !== this.segment.substr(0, 5)) {
      return;
    }
    
    if (frameIndex < this.segmentMetadata.size - 1) {
      websocket.send(`${this.segment}_${frameIndex + 1}_pointcloud`);
    }

    const offsets = [];
    const intensities = [];
    const lasers = [];
    const labels = [];
    const predictedTypes = [];

    data.forEach((x, index) => {
      if ([0, 1, 2].includes(index % 6)) offsets.push(x);
      else if (index % 6 === 3) intensities.push(x);
      else if (index % 6 === 4) lasers.push(x);
      else if (index % 6 === 5) labels.push(x);
      if (index % 6 === 0) predictedTypes.push(-1);
    });

    const mesh = (new PointMesh(
      intensities.length,
      offsets,
      intensities,
      lasers,
      labels,
      predictedTypes,
    )).getMesh();

    mesh.scale.x = 0.2;
    mesh.scale.y = 0.2;
    mesh.scale.z = 0.2;

    this.onFramePointCloudReceived(frameIndex, mesh);
  }
  
  private onMessage(websocket: WebSocket, event: MessageEvent) {
    if (typeof(event.data) === 'string') {
      // Received comma separated list of supported segment ids
      this.handleSegmentsMessage(websocket, event);
    } else {
      const [type, segmentId, frameIndex, ...rest] = new Float32Array(event.data);
      const data = new Float32Array(rest);

      if (type === 0) {
        // Received binary point cloud data
        this.handlePointCloudMessage(websocket, segmentId.toString(), frameIndex, data);
      } else if (type === 1) {
        // Received binary bounding box data
        this.handleBoundingBoxesMessage(websocket, segmentId.toString(), frameIndex, data);
      } else if (type === 2) {
        // Received binary segment metadata
        this.handleSegmentMetadataMessage(websocket, segmentId.toString(), data);
      }
    }
  }
}

export default DataSocket;
